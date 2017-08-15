(ns cumulus.provider-gateway.task-executor
   "TODO"
   (:require
    [clojure.spec.alpha :as s]
    [clojure.core.async :as a]
    [com.stuartsierra.component :as c]
    [cumulus.provider-gateway.aws.s3 :as s3]
    [cumulus.provider-gateway.protocols.url-connection :as url-conn]
    [cumulus.provider-gateway.util :as util]
    [cumulus.provider-gateway.specs.task :as specs]
    [cumulus.provider-gateway.protocols.ftp :as ftp-conn]
    [cumulus.provider-gateway.protocols.http :as http-conn]))

;; TODO add validation that URLs match the connection protocol configured

(defn- create-connection
  "TODO"
  [conn-config]
  (case (:conn_type conn-config)
    "ftp" (ftp-conn/create-ftp-connection conn-config)
    "http" (http-conn/create-http-connection)
    ;; else
    (throw (Exception. (format "Unexpected connection type [%s]" (:conn_type conn-config))))))

(defn version-skip-download?
  "Returns true if we should skip the download to S3 if the key has data at the given bucket"
  [s3-api bucket key version]
  (when version
    (let [metadata (s3/get-s3-object-metadata s3-api bucket key)]
      (= version (get-in metadata [:user-metadata :version])))))

(defn- request->s3-target
  "Takes a task and request and returns the target bucket and key."
  [task request]
  (let [{:keys [target]} request]
    (cond
      (:bucket target)
      target

      (= "FROM_CONFIG" target)
      (let [{:keys [bucket key_prefix]} (get-in task [:config :output])
            file-name (util/url->file-name (get-in request [:source :url]))]
        {:bucket bucket
         :key (str key_prefix "/" file-name)})

      :else
      (throw (Exception. (str "Unable to determine target for request " (pr-str request)))))))

(defn- process-download-request
  "TODO"
  [s3-api conn log task request]
  (let [{{:keys [url size version]} :source} request
        {:keys [bucket key]} (request->s3-target task request)
        size-log-msg (str "(" (or size "unknown") " bytes)")
        version-log-msg (if version (str " with version " version) "")
        ;; Return the request with the bucket and key in the target. This may have been dynamically
        ;; generated.
        request (assoc request :target {:bucket bucket :key key})]
    ;; TODO consider whether to fix this now or later
    ;; Performance Note: The version skip download check is on the same thread as the download.
    ;; ideally this could be filtered out ahead of time so we don't waste time utilizing a provider
    ;; connection for this.
    ;; IMPORTANT NOTE: If we change this in the future to filter out somewhere before it even gets
    ;; to the task we need to make sure that we still report the file as successfully completed in
    ;; the response. This is needed for the sync activity handler so that it can report all the
    ;; files that are in S3.
    (when-not (version-skip-download? s3-api bucket key version)
      (log (format "Transfering %s %s%s to S3 %s %s"
                   url size-log-msg version-log-msg bucket key))

      ;; TODO time how long this takes and print it out. (get stream to s3 put object completion)
      ;; That's the total time it took to download the file and save it to s3 (streaming-wise)
      (if-let [stream (url-conn/download conn url)]
        (do
          (s3/write-s3-stream s3-api bucket key stream
                              {:content-length size
                               :user-metadata {:version version}})
          (assoc request :success true))

        ;; The URL does not exist
        (assoc request
               :success false
               ;; TODO test this with http.
               :error "The file did not exist at the source.")))))

(defn- process-request
  "TODO"
  [s3-api conn log task request]
  (case (:type request)
    "download" (process-download-request s3-api conn log task request)
    ;; else
    (throw (Exception. (format "Unexpected request type %s" (pr-str request))))))

(defn- process-task
  "TODO"
  [s3-api conn log task]
  (s/assert ::specs/task task)
  (let [{:keys [completion-channel input task-token]} task
        request-results (mapv (fn [request]
                                (try
                                  (process-request s3-api conn log task request)
                                  (catch Exception e
                                    (.printStackTrace e)
                                    (assoc request
                                           :success false
                                           :error (.getMessage e)))))
                              (:files input))
        completion-msg (assoc task :results request-results :success true)]
    (a/>!! completion-channel completion-msg)))

(defn- create-task-processing-threads
  "TODO"
  [s3-api provider task-channel]
  (let [{:keys [provider-id conn_config num_connections]} provider]
    ;; TODO in my testing here it seems like there's only 1 upload going on at a time while I have 2 connections configured.
    ;; Make sure this is actually working as expected.
    (doall
     (for [thread-num (range 1 (inc num_connections))
           :let [thread-id (str provider-id "-" thread-num)
                 log (fn [& args] (apply println "Thread" thread-id "-" args))
                 conn (create-connection conn_config)]]
       (a/thread
        (try
          (util/while-let
           [task (a/<!! task-channel)]
           (try
             (process-task s3-api conn log task)
             (catch Exception e
               (.printStackTrace e))))
          (finally
            (println "Processing thread" thread-id "completed")
            (url-conn/close conn))))))))

;; TODO
(defrecord TaskExecutor
  [
   s3-api

   ;; TODO
   provider

   ;; --- Dependencies ---

   ;; A channel containing tasks that need to be completed
   task-channel

   ;; --- Runtime state ---
   task-thread-chs]

  c/Lifecycle
  (start
   [this]
   (if-not task-thread-chs
     (assoc this
            :task-thread-chs
            (create-task-processing-threads s3-api provider task-channel))
     this))

  (stop
   [this]
   (if task-thread-chs
     (do
       ;; Close task channel so that waiting thread will stop
       (a/close! task-channel)
       ;; Wait until all the task thread channels are closed. That means the threads have completed.
       (doseq [task-thread-ch task-thread-chs]
         (a/<!! task-thread-ch))
       (assoc this :task-thread-chs nil))
     this)))

(defn create-task-executor
 "TODO"
 [provider]
 (map->TaskExecutor {:provider provider}))
