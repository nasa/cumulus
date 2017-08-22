(ns cumulus.provider-gateway.integration-test
  (:require
   [clojure.java.io :as io]
   [clojure.string :as str]
   [clojure.test :refer :all]
   [com.stuartsierra.component :as c]
   [cumulus.provider-gateway.system :as sys]
   [cumulus.provider-gateway.aws.activity-api :as activity-api]
   [cumulus.provider-gateway.util :as util]
   [cumulus.provider-gateway.http-server :as http-server]
   [cumulus.provider-gateway.ftp-server :as ftp-server]
   [cumulus.provider-gateway.sftp-server :as sftp-server]))

(def http-files->content
  {"/foo/bar.txt" "bar bar bar"
   "/foo/bar2.txt" "another bar"
   "/moo.txt" "a cow"})

(def ftp-files->content
  {"/ftp/foo/bar.txt" "ftp bar bar bar"
   "/ftp/foo/bar2.txt" "ftp another bar"
   "/ftp/moo.txt" "a cow over ftp"})

(def sftp-files->content
  {"/sftp/foo/bar.txt" "sftp bar bar bar"
   "/sftp/foo/bar2.txt" "sftp another bar"
   "/sftp/moo.txt" "a cow over sftp"})

(def running-ftp-server
  "This will dynamically contain a reference to the running ftp server which is a map of info like
   username and password."
  nil)

(def running-sftp-server
  "This will dynamically contain a reference to the running sftp server which is a map of info like
   username and password."
  nil)

(def running-http-server
  "This will dynamically contain a reference to the running http server which is a map of info like
   port."
  nil)

(use-fixtures :once (join-fixtures [(ftp-server/create-run-ftp-fixture
                                     #'running-ftp-server
                                     {:file-paths->contents ftp-files->content})
                                    (sftp-server/create-run-sftp-fixture
                                     #'running-sftp-server
                                     {:file-paths->contents sftp-files->content})
                                    (http-server/create-run-jetty-fixture
                                     #'running-http-server
                                     {:file-paths->contents http-files->content})]))

(def storage-bucket
  "the-bucket")

(defn create-url
  [type path]
  (let [port (:port (case type
                      :http running-http-server
                      :ftp running-ftp-server
                      :sftp running-sftp-server))
        ;; to make running in repl easier
        port (or port 1111)]

    (format "%s://localhost:%d/%s" (name type) port path)))

(defn create-download-request
  ([type path]
   (create-download-request type path nil))
  ([type path options]
   (let [file-url (create-url type path)
         file-name (util/url->file-name file-url)]
     (merge-with merge
                 {:type "download"
                  :source {:url file-url}
                  :target {:bucket storage-bucket
                           :key file-name}}
                 options))))

(defn create-successful-download-request
  ([type path]
   (create-successful-download-request type path nil))
  ([type path options]
   (assoc (create-download-request type path options) :success true)))

(defn create-failed-download-request
  ([type path]
   (create-failed-download-request type path nil))
  ([type path options]
   (let [request (create-download-request type path options)
         url (get-in request [:source :url])
         error "The file did not exist at the source."]
     (assoc request :success false :error error))))

(defn create-download-task
  "Creates a task containing a list of downloads to process"
  [task-token download-requests]
  {:task-token task-token
   :input
   {:workflow_config_template
    {:DownloadActivity {:skip_upload_output_payload_to_s3 true
                        :output {:bucket "{resources.buckets.private}"
                                 :key_prefix "sources/EPSG{meta.epsg}/SIPSTEST/{meta.collection}"}}}
    :resources {:buckets {:private storage-bucket}}
    :meta {:collection "VNGCR_LQD_C1"
           :epsg 4326}
    :payload {:ignored-key "This is ignored"
              :files download-requests}}})

(defn create-download-task-output
  "Creates the expected output for a task given some of the completed task download requests."
  [completed-download-requests]
  ;; The ouput is the same as the input with the files containing the completed download requests
  (:input (create-download-task nil completed-download-requests)))

(def MAX_WAIT_TIME 5000)

(defn wait-for-tasks-to-complete
  [activity-api task-ids]
  (let [start (System/currentTimeMillis)
        get-completed-tasks (fn []
                              (let [{:keys [successful-tasks-atom failed-tasks-atom]} activity-api]
                                (set (concat (keys @successful-tasks-atom)
                                             (keys @failed-tasks-atom)))))
        done? #(= (get-completed-tasks) (set task-ids))]
    (while (not (done?))
      (when (> (- (System/currentTimeMillis) start) MAX_WAIT_TIME)
        (throw (Exception.
                (format "All tasks not consumed within timeout period. Completed: %s Expecting: %s"
                        (pr-str (get-completed-tasks)) (pr-str task-ids)))))
      (Thread/sleep 250))))

(defn create-expected-s3
  "Creates a map of expected s3 content from a list of file paths and the map of files->content"
  ([files->content file-paths->versions]
   (create-expected-s3 "" files->content file-paths->versions))
  ([key-prefix files->content file-paths->versions]
   {storage-bucket
    (reduce (fn [contents [path version]]
              (assoc contents
                     (str key-prefix (last (str/split path #"/")))
                     {:value (files->content path)
                      :metadata {:content-length (count (files->content path))
                                 :user-metadata {:version version}}}))
            {}
            file-paths->versions)}))

(deftest http-download-request-integration-test
  (let [task1-download-requests [(create-download-request :http "/foo/bar.txt" {:source {:version "v1"}})
                                 (create-download-request :http "/foo/bar2.txt" {:source {:version "v1"}})]
        expected-task-1-completed-requests [(create-successful-download-request
                                             :http "/foo/bar.txt" {:source {:version "v1"}})
                                            (create-successful-download-request
                                             :http "/foo/bar2.txt" {:source {:version "v1"}})]
        task2-download-requests [(create-download-request :http "moo2.txt") ;; doesn't exist
                                 (create-download-request :http "moo.txt")]
        expected-task-2-completed-requests [(create-failed-download-request :http "moo2.txt")
                                            (create-successful-download-request :http "moo.txt")]
        provider {:provider-id "LOCAL",
                  :s3-api-type :in-memory
                  :activity-api {:activity-api-type "in-memory"
                                 :tasks [(create-download-task "task-1" task1-download-requests)
                                         (create-download-task "task-2" task2-download-requests)]}
                  :conn_config {:conn_type "http"}
                  :num_connections 2}
        system (c/start (sys/create-system [provider]))
        activity-api (get-in system [:LOCAL-download-activity-handler :activity-api])
        s3-api (:LOCAL-s3-api system)
        expected-s3 (create-expected-s3
                     http-files->content
                     {"/foo/bar.txt" "v1"
                      "/foo/bar2.txt" "v1"
                      "/moo.txt" nil})]
    (try
      (wait-for-tasks-to-complete activity-api ["task-1" "task-2"])
      (finally
        (c/stop system)))
    ;; verify the files in s3
    (is (= expected-s3 (-> s3-api :bucket-key-to-value-atom deref)))
    ;; Verify no failures sent to activity api
    (is (= {} (-> activity-api :failed-tasks-atom deref)))

    ;; Verify successful output from download requests.
    (is (= {"task-1" (create-download-task-output expected-task-1-completed-requests)
            "task-2" (create-download-task-output expected-task-2-completed-requests)}
           (-> activity-api :successful-tasks-atom deref)))

    ;; Testing download with versioning
    (let [task3-download-requests [(create-download-request :http "/foo/bar.txt" {:source {:version "v1"}})
                                   (create-download-request :http "/foo/bar2.txt" {:source {:version "v2"}})]
          expected-task-3-completed-requests [(create-successful-download-request
                                               :http "/foo/bar.txt" {:source {:version "v1"}
                                                                     :version_skip true})
                                              (create-successful-download-request
                                               :http "/foo/bar2.txt" {:source {:version "v2"}})]
          provider (assoc-in provider [:activity-api :tasks]
                             [(create-download-task "task-3" task3-download-requests)])
          system (-> (sys/create-system [provider])
                     (assoc :LOCAL-s3-api s3-api)
                     c/start)
          activity-api (get-in system [:LOCAL-download-activity-handler :activity-api])
          expected-s3 (create-expected-s3
                       http-files->content
                       {"/foo/bar.txt" "v1"
                        "/foo/bar2.txt" "v2"
                        "/moo.txt" nil})]
      (try
        (wait-for-tasks-to-complete activity-api ["task-3"])
        (finally
          (c/stop system)))
      ;; verify the files in s3
      (is (= expected-s3 (-> s3-api :bucket-key-to-value-atom deref)))
      ;; Verify no failures sent to activity api
      (is (= {} (-> activity-api :failed-tasks-atom deref)))

      ;; Verify successful output from download requests.
      (is (= {"task-3" (create-download-task-output expected-task-3-completed-requests)}
             (-> activity-api :successful-tasks-atom deref))))))

(deftest from-config-integration-test
  (let [task1-download-requests [(create-download-request :http "/foo/bar.txt")
                                 (create-download-request :http "/foo/bar2.txt")]
        task1-download-requests (map #(assoc % :target "FROM_CONFIG") task1-download-requests)
        expected-task-1-completed-requests [(create-successful-download-request :http "/foo/bar.txt")
                                            (create-successful-download-request :http "/foo/bar2.txt")]
        expected-task-1-completed-requests (map (fn [file]
                                                  (update-in
                                                   file [:target :key]
                                                   #(str "sources/EPSG4326/SIPSTEST/VNGCR_LQD_C1/" %)))
                                                expected-task-1-completed-requests)
        provider {:provider-id "LOCAL",
                  :s3-api-type :in-memory
                  :activity-api {:activity-api-type "in-memory"
                                 :tasks [(create-download-task "task-1" task1-download-requests)]}
                  :conn_config {:conn_type "http"}
                  :num_connections 2}
        system (c/start (sys/create-system [provider]))
        activity-api (get-in system [:LOCAL-download-activity-handler :activity-api])
        s3-api (:LOCAL-s3-api system)
        expected-s3 (create-expected-s3
                     "sources/EPSG4326/SIPSTEST/VNGCR_LQD_C1/"
                     http-files->content
                     {"/foo/bar.txt" nil
                      "/foo/bar2.txt" nil})]
    (try
      (wait-for-tasks-to-complete activity-api ["task-1"])
      (finally
        (c/stop system)))
    ;; verify the files in s3
    (is (= expected-s3 (-> s3-api :bucket-key-to-value-atom deref)))
    ;; Verify no failures sent to activity api
    (is (= {} (-> activity-api :failed-tasks-atom deref)))

    ;; Verify successful output from download requests.
    (is (= {"task-1" (create-download-task-output expected-task-1-completed-requests)}
           (-> activity-api :successful-tasks-atom deref)))))


(deftest ftp-download-request-integration-test
  (let [task1-download-requests [(create-download-request :ftp "/ftp/foo/bar.txt")
                                 (create-download-request :ftp "/ftp/foo/bar2.txt")]
        expected-task-1-completed-requests [(create-successful-download-request :ftp "/ftp/foo/bar.txt")
                                            (create-successful-download-request :ftp "/ftp/foo/bar2.txt")]
        task2-download-requests [(create-download-request :ftp "/ftp/moo2.txt") ;; doesn't exist
                                 (create-download-request :ftp "/ftp/moo.txt")]
        expected-task-2-completed-requests [(create-failed-download-request :ftp "/ftp/moo2.txt")
                                            (create-successful-download-request :ftp "/ftp/moo.txt")]
        provider {:provider-id "LOCAL",
                  :s3-api-type :in-memory
                  :activity-api {:activity-api-type "in-memory"
                                 :tasks [(create-download-task "task-1" task1-download-requests)
                                         (create-download-task "task-2" task2-download-requests)]}
                  :conn_config (merge {:conn_type "ftp" :host "localhost"}
                                      (select-keys running-ftp-server [:username :password :port]))
                  :num_connections 2}
        system (c/start (sys/create-system [provider]))
        activity-api (get-in system [:LOCAL-download-activity-handler :activity-api])
        s3-api (:LOCAL-s3-api system)
        expected-s3 (create-expected-s3
                     ftp-files->content
                     {"/ftp/foo/bar.txt" nil
                      "/ftp/foo/bar2.txt" nil
                      "/ftp/moo.txt" nil})]
    (try
      (wait-for-tasks-to-complete activity-api ["task-1" "task-2"])
      (finally
        (c/stop system)))
    ;; verify the files in s3
    (is (= expected-s3 (-> s3-api :bucket-key-to-value-atom deref)))
    ;; Verify no failures sent to activity api
    (is (= {} (-> activity-api :failed-tasks-atom deref)))

    ;; Verify successful output from download requests.
    (is (= {"task-1" (create-download-task-output expected-task-1-completed-requests)
            "task-2" (create-download-task-output expected-task-2-completed-requests)}
           (-> activity-api :successful-tasks-atom deref)))))

(deftest sftp-download-request-integration-test
  (let [task1-download-requests [(create-download-request :sftp "/sftp/foo/bar.txt")
                                 (create-download-request :sftp "/sftp/foo/bar2.txt")]
        expected-task-1-completed-requests [(create-successful-download-request :sftp "/sftp/foo/bar.txt")
                                            (create-successful-download-request :sftp "/sftp/foo/bar2.txt")]
        task2-download-requests [(create-download-request :sftp "/sftp/moo2.txt") ;; doesn't exist
                                 (create-download-request :sftp "/sftp/moo.txt")]
        expected-task-2-completed-requests [(create-failed-download-request :sftp "/sftp/moo2.txt")
                                            (create-successful-download-request :sftp "/sftp/moo.txt")]
        provider {:provider-id "LOCAL",
                  :s3-api-type :in-memory
                  :activity-api {:activity-api-type "in-memory"
                                 :tasks [(create-download-task "task-1" task1-download-requests)
                                         (create-download-task "task-2" task2-download-requests)]}
                  :conn_config (merge {:conn_type "sftp"
                                       :host "localhost"
                                       :username "ignored on server"
                                       :password "ignored on test server"
                                       :disable-strict-host-checking true}
                                      (select-keys running-sftp-server [:port]))
                  :num_connections 2}
        system (c/start (sys/create-system [provider]))
        activity-api (get-in system [:LOCAL-download-activity-handler :activity-api])
        s3-api (:LOCAL-s3-api system)
        expected-s3 (create-expected-s3
                     sftp-files->content
                     {"/sftp/foo/bar.txt" nil
                      "/sftp/foo/bar2.txt" nil
                      "/sftp/moo.txt" nil})]
    (try
      (wait-for-tasks-to-complete activity-api ["task-1" "task-2"])
      (finally
        (c/stop system)))
    ;; verify the files in s3
    (is (= expected-s3 (-> s3-api :bucket-key-to-value-atom deref)))
    ;; Verify no failures sent to activity api
    (is (= {} (-> activity-api :failed-tasks-atom deref)))

    ;; Verify successful output from download requests.
    (is (= {"task-1" (create-download-task-output expected-task-1-completed-requests)
            "task-2" (create-download-task-output expected-task-2-completed-requests)}
           (-> activity-api :successful-tasks-atom deref)))))

(defn create-sync-task
  "Creates a synchronization task"
  [task-token files]
  {:task-token task-token
   :input
   {:workflow_config_template
    {:SyncHttpUrls {:skip_upload_output_payload_to_s3 true
                    :output {:bucket "{resources.buckets.private}"
                             :key_prefix "sources/EPSG{meta.epsg}/SIPSTEST/{meta.collection}"}}}
    :resources {:buckets {:private storage-bucket}}
    :meta {:collection "VNGCR_LQD_C1"
           :epsg 4326}
    :payload files}})

(defn create-sync-task-output
  "Creates the expected output for a task given some of the completed task sync requests."
  [files]
  ;; The ouput is the same as the input with the files containing the completed download requests
  (let [message (:input (create-sync-task nil files))]
    ;; The payload output is a map with Bucket and Key of the files in their new location.
    (update message :payload (fn [files]
                               (map (fn [file]
                                      {:Bucket storage-bucket
                                       :Key (str "sources/EPSG4326/SIPSTEST/VNGCR_LQD_C1/"
                                                 (util/url->file-name (:url file)))})
                                    files)))))

(deftest sync-task-integration-test
  (let [sync-files-1 [{:url (create-url :http "/foo/bar.txt") :version "bar-1"}
                      {:url (create-url :http "/foo/bar2.txt") :version "bar2-1"}]
        provider {:provider-id "LOCAL",
                  :s3-api-type :in-memory
                  :sync-activity-api {:activity-api-type "in-memory"
                                      :tasks [(create-sync-task "task-1" sync-files-1)]}
                  :conn_config {:conn_type "http"}
                  :num_connections 2}
        system (c/start (sys/create-system [provider]))
        activity-api (get-in system [:LOCAL-sync-activity-handler :activity-api])
        s3-api (:LOCAL-s3-api system)
        expected-s3 (create-expected-s3
                     "sources/EPSG4326/SIPSTEST/VNGCR_LQD_C1/"
                     http-files->content
                     {"/foo/bar.txt" "bar-1"
                      "/foo/bar2.txt" "bar2-1"})]
    (testing "Sync with everything new"
      (try
        (wait-for-tasks-to-complete activity-api ["task-1"])
        (finally
          (c/stop system)))
      ;; verify the files in s3
      (is (= expected-s3 (-> s3-api :bucket-key-to-value-atom deref)))
      ;; Verify no failures sent to activity api
      (is (= {} (-> activity-api :failed-tasks-atom deref)))

      ;; Verify successful output from download requests.
      (is (= {"task-1" (create-sync-task-output sync-files-1)}
             (-> activity-api :successful-tasks-atom deref))))

    (let [sync-files-2 [{:url (create-url :http "/foo/bar.txt") :version "bar-1"} ;; same version
                        {:url (create-url :http "/foo/bar2.txt") :version "bar2-2"} ;; newer version
                        {:url (create-url :http "/moo.txt") :version "moo-1"}] ;; new file
          provider (assoc-in provider [:sync-activity-api :tasks]
                             [(create-sync-task "task-2" sync-files-2)])
          system (-> (sys/create-system [provider])
                     ;; Use the same mock s3 so the existing state will be persisted
                     (assoc :LOCAL-s3-api s3-api)
                     c/start)
          activity-api (get-in system [:LOCAL-sync-activity-handler :activity-api])
          expected-s3 (create-expected-s3
                       "sources/EPSG4326/SIPSTEST/VNGCR_LQD_C1/"
                       http-files->content
                       {"/foo/bar.txt" "bar-1"
                        "/foo/bar2.txt" "bar2-2"
                        "/moo.txt" "moo-1"})]
      (testing "Sync with some updates"
        (try
          (wait-for-tasks-to-complete activity-api ["task-2"])
          (finally
            (c/stop system)))
        ;; verify the files in s3
        (is (= expected-s3 (-> s3-api :bucket-key-to-value-atom deref)))
        ;; Verify no failures sent to activity api
        (is (= {} (-> activity-api :failed-tasks-atom deref)))

        ;; Verify successful output from download requests.
        (is (= {"task-2" (create-sync-task-output sync-files-2)}
               (-> activity-api :successful-tasks-atom deref))))

      (let [;; Creating a system with the same sync files as above with the same sync files.
            ;; The sync task should find that there's nothing to do and return an exception
            provider (assoc-in provider [:sync-activity-api :tasks]
                               [(create-sync-task "task-3" sync-files-2)])
            system (-> (sys/create-system [provider])
                       ;; Use the same mock s3 so the existing state will be persisted
                       (assoc :LOCAL-s3-api s3-api)
                       c/start)
            activity-api (get-in system [:LOCAL-sync-activity-handler :activity-api])]
        (testing "Sync with no new updates"
          (try
            (wait-for-tasks-to-complete activity-api ["task-3"])
            (finally
              (c/stop system)))
          ;; Verify no failures sent to activity api
          (is (= {} (-> activity-api :failed-tasks-atom deref)))

          ;; Verify successful output from download requests.
          (is (= {"task-3" {:exception "NotNeededWorkflowError"}}
                 (-> activity-api :successful-tasks-atom deref))))))))

(deftest sync-task-file-doesnt-exist-integration-test
  (let [sync-files-1 [{:url (create-url :http "/foo/bar.txt") :version "bar-1"}
                      {:url (create-url :http "moo2.txt") :version "moo1"}] ;; doesn't exist
        provider {:provider-id "LOCAL",
                  :s3-api-type :in-memory
                  :sync-activity-api {:activity-api-type "in-memory"
                                      :tasks [(create-sync-task "task-1" sync-files-1)]}
                  :conn_config {:conn_type "http"}
                  :num_connections 2}
        system (c/start (sys/create-system [provider]))
        activity-api (get-in system [:LOCAL-sync-activity-handler :activity-api])]
    (try
      (wait-for-tasks-to-complete activity-api ["task-1"])
      (finally
        (c/stop system)))
    ;; Verify no failures sent to activity api
    (is (= {} (-> activity-api :failed-tasks-atom deref)))

    ;; Verify successful output from download requests.
    (is (= {"task-1" {:exception "RemoteResourceError"}}
           (-> activity-api :successful-tasks-atom deref)))))

