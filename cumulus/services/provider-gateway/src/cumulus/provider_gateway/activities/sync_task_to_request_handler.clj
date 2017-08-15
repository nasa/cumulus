(ns cumulus.provider-gateway.activities.sync-task-to-request-handler
  "Provides code that handles tasks read from the activity API that indicate we should synchronize
   files with contents already in S3."
  (:require
   [clojure.spec.alpha :as s]
   [cumulus.provider-gateway.activity-handler :as activity-handler]
   [cumulus.provider-gateway.util :as util]
   [cumulus.provider-gateway.aws.s3 :as s3]
   [cumulus.provider-gateway.specs.config :as config-spec]
   [cumulus.provider-gateway.specs.sync-task :as sync-spec]))

;; TODO the input to the sync activity includes just the files. If we were to get the file sizes
;; when scanning the folder we'd be able to improve S3 upload speeds. File an issue for this to
;; improve the sync step

(def TASK_NAME
  "SyncHttpUrls")

(defn- file->download-request
  "Converts a file into a download request."
  [config file]
  (s/assert ::sync-spec/file file)
  (s/assert ::config-spec/config config)
  (let [{{:keys [bucket key_prefix]} :output} config
        file-name (util/url->file-name (:url file))]
   {:type "download"
    :source file
    :target {:bucket bucket
             :key (str key_prefix "/" file-name)}}))

(defrecord SyncTaskToRequestHandler
  [s3-api]

  activity-handler/TaskToRequests

  (handle-new-task
   [_ task]
   ;; TODO we should enforce the specs here instead of in file->download-request
   (let [task-updated (activity-handler/default-handle-new-task TASK_NAME s3-api task)]
     (assoc task-updated :input
            {:files (mapv #(file->download-request (:config task-updated) %) (:input task-updated))})))

  ;; TODO the response from this should include an .exception if no synchronization is required.
  (handle-completed-task
   [_ completion-request]
   (let [payload-files (->> completion-request
                            :results
                            ;; Get the successful completions
                            (filter :success)
                            ;; Get their upload locations
                            (map :target)
                            ;; Change to the style expected
                            (map #(hash-map :Bucket (:bucket %) :Key (:key %))))
         message (-> completion-request
                     :original-message
                     (assoc :payload payload-files))]
     (activity-handler/upload-large-payload
      TASK_NAME
      s3-api
      (:config completion-request)
      message))))

(defn create-sync-task-to-request-handler
  ([]
   (create-sync-task-to-request-handler s3/aws-s3-api))
  ([s3-api]
   (->SyncTaskToRequestHandler s3-api)))
