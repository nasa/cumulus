(ns cumulus.provider-gateway.activities.sync-task-to-request-handler-test
  (:require
   [clojure.test :refer :all]
   [cheshire.core :as json]
   [cumulus.provider-gateway.download-activity-handler :as activity-handler]
   [cumulus.provider-gateway.activities.sync-task-to-request-handler :as strh]
   [cumulus.provider-gateway.aws.s3 :as s3]))

(def private-bucket
  "gitc-private")

(def meta-key
  "VIIRS/VNGCR_LQD_C1/2017192")

(defn stage-data
  "Stages data in the in-memory s3 of the given set of files and returns a new synchronization task."
  [in-memory-s3 files]
  (let [payload-s3-key "LastStep/Payload"]
    ;; Stage the payload for the task message
    (s3/write-s3-json in-memory-s3 private-bucket payload-s3-key files)
    ;; Return the task with the message
    {:task-token "task-token"
     :input
     {:workflow_config_template
      {:SyncHttpUrls {:output {:bucket "{resources.buckets.private}"
                               :key_prefix "sources/EPSG{meta.epsg}/{meta.key}"}}}
      :resources {:buckets {:private private-bucket}}
      :meta {:key meta-key
             :epsg 4326}
      :payload {:Bucket private-bucket
                :Key payload-s3-key}}}))

(deftest handle-new-task-test
  (let [in-memory-s3 (s3/create-in-memory-s3-api)
        handler (strh/create-sync-task-to-request-handler in-memory-s3)
        files [{:url "http://example.com/foo/1.txt"
                :version "v1"}
               {:url "http://example.com/foo/2.txt"
                :version "v1"}]
        task (stage-data in-memory-s3 files)
        updated-task (activity-handler/handle-new-task handler task)

        expected-input [{:type "download"
                         :source {:url "http://example.com/foo/1.txt"
                                  :version "v1"}
                         :target {:bucket private-bucket
                                  :key "sources/EPSG4326/VIIRS/VNGCR_LQD_C1/2017192/1.txt"}}
                        {:type "download"
                         :source {:url "http://example.com/foo/2.txt"
                                  :version "v1"}
                         :target {:bucket private-bucket
                                  :key "sources/EPSG4326/VIIRS/VNGCR_LQD_C1/2017192/2.txt"}}]]
    ;; What do we expect the new task to look like?
    (is (= {:task-token (:task-token task)
            :config {:output {:bucket "gitc-private"
                              :key_prefix "sources/EPSG4326/VIIRS/VNGCR_LQD_C1/2017192"}}
            :original-message (:input task)
            :input {:files expected-input}}
           updated-task))))

(deftest handle-completed-task-test
  (let [in-memory-s3 (s3/create-in-memory-s3-api)
        handler (strh/create-sync-task-to-request-handler in-memory-s3)
        files [{:url "http://example.com/foo/1.txt"
                :version "v1"}
               {:url "http://example.com/foo/2.txt"
                :version "v1"}]
        task (stage-data in-memory-s3 files)

        input [{:type "download"
                :source {:url "http://example.com/foo/1.txt"
                         :version "v1"}
                :target {:bucket private-bucket
                         :key "sources/EPSG4326/VIIRS/VNGCR_LQD_C1/2017192/1.txt"}}
               {:type "download"
                :source {:url "http://example.com/foo/2.txt"
                         :version "v1"}
                :target {:bucket private-bucket
                         :key "sources/EPSG4326/VIIRS/VNGCR_LQD_C1/2017192/2.txt"}}]

        completion-request {:task-token (:task-token task)
                            :original-message (:input task)
                            :input input
                            :results (map #(assoc % :success true) input)}

        ;; The expected output to pass to the next task should be the same message with a payload
        ;; uploaded to S3.
        payload-key (str strh/TASK_NAME "/" meta-key)
        expected-output (assoc (:input task) :payload {:Bucket private-bucket
                                                       :Key payload-key})]
    (is (= expected-output (activity-handler/handle-completed-task handler completion-request)))
    ;; Check the payload in the message in S3 has the right content
    (is (= [{:Bucket private-bucket
             :Key "sources/EPSG4326/VIIRS/VNGCR_LQD_C1/2017192/1.txt"}
            {:Bucket private-bucket
             :Key "sources/EPSG4326/VIIRS/VNGCR_LQD_C1/2017192/2.txt"}]
           (s3/read-s3-json in-memory-s3 private-bucket payload-key)))))

