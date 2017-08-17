(ns cumulus.provider-gateway.task-executor
   "Defines a components and functions for executing download task requests."
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

(defn- create-connection
  "Creates a connection based from a provider connection configuration."
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

      ;; If the target is FROM_CONFIG then we will generate the bucket and key from the task
      ;; configuration
      (= "FROM_CONFIG" target)
      (let [{:keys [bucket key_prefix]} (get-in task [:config :output])
            file-name (util/url->file-name (get-in request [:source :url]))]
        {:bucket bucket
         :key (str key_prefix "/" file-name)})

      :else
      (throw (Exception. (str "Unable to determine target for request " (pr-str request)))))))

;; Performance Note: The version skip download check below is on the same thread as the download.
;; ideally this could be filtered out ahead of time so we don't waste time utilizing a provider
;; connection for this.
;; IMPORTANT NOTE: If we change this in the future to filter out somewhere before it even gets
;; to the task we need to make sure that we still report the file as successfully completed in
;; the response. This is needed for the sync activity handler so that it can report all the
;; files that are in S3.

(defn- process-download-request
  "Processes a request to download a single file from a URL and upload it to S3"
  [s3-api conn log task request]
  (let [{{:keys [url size version]} :source} request
        {:keys [bucket key]} (request->s3-target task request)

        ;; Return the request with the bucket and key in the target. This may have been dynamically
        ;; generated.
        request (assoc request :target {:bucket bucket :key key})]
    (if (version-skip-download? s3-api bucket key version)
      ;; version is present and matches so we won't download it
      (assoc request :success true :version_skip true)

      ;; Version is out of date or not present
      (let [;; Fetch the size of the content if we don't know it.
            size (or size (url-conn/get-size conn url))
            size-log-msg (str "(" (or size "unknown") " bytes)")
            version-log-msg (if version (str " with version " version) "")
            start-time (System/currentTimeMillis)]
        (log (format "Transfering %s %s%s to S3 %s %s"
                     url size-log-msg version-log-msg bucket key))
        (if-let [stream (url-conn/download conn url)]
          (do
            (s3/write-s3-stream s3-api bucket key stream
                                {:content-length size
                                 :user-metadata {:version version}})
            (log (format "Completed download and upload to s3 %s in %d ms."
                         size-log-msg (- (System/currentTimeMillis) start-time)))
            (assoc request :success true))

          ;; The URL does not exist
          (assoc request
                 :success false
                 :error "The file did not exist at the source."))))))

(defn- create-download-processing-threads
  "Creates a set of threads for processing requests of the task channel"
  [s3-api provider downloads-channel]
  (let [{:keys [provider-id conn_config num_connections]} provider]
    (doall
     (for [thread-num (range 1 (inc num_connections))
           :let [thread-id (str provider-id "-" thread-num)
                 log (fn [& args] (apply println "Thread" thread-id "-" args))
                 conn (create-connection conn_config)]]
       (a/thread
        (try
          (util/while-let
           [{:keys [file download-completion-ch task]} (a/<!! downloads-channel)]
           (let [result (try
                          (process-download-request s3-api conn log task file)
                          (catch Exception e
                            (.printStackTrace e)
                            (assoc file
                                   :success false
                                   :error (.getMessage e))))]
             (a/>!! download-completion-ch result)))
          (finally
            (println "Processing thread" thread-id "completed")
            (url-conn/close conn))))))))

(defn- process-task
  "Processes a task downloading all of the files in it."
  [task downloads-channel]
  (s/assert ::specs/task task)
  (let [{:keys [completion-channel input]} task
        download-completion-chs (mapv (fn [file]
                                        (let [download-completion-ch (a/chan 1)]
                                          (a/>!! downloads-channel
                                                 {:file file
                                                  :task task
                                                  :download-completion-ch download-completion-ch})
                                          download-completion-ch))
                                      (:files input))
        results (mapv a/<!! download-completion-chs)
        completion-msg (assoc task :results results :success true)]
    (a/>!! completion-channel completion-msg)))

(defn- create-task-processing-threads
  "Creates a set of threads for processing requests of the task channel"
  [provider task-channel downloads-channel]
  (let [{:keys [provider-id num_connections]} provider]
    (doall
     (for [thread-num (range 1 (inc num_connections))
           :let [thread-id (str provider-id "-" thread-num)]]
       (a/thread
        (try
          (util/while-let
           [task (a/<!! task-channel)]
           (try
             (process-task task downloads-channel)
             (catch Exception e
               (.printStackTrace e))))
          (finally
            (println "Processing thread" thread-id "completed"))))))))

(defrecord TaskExecutor
  [
   s3-api

   provider

   ;; --- Dependencies ---

   ;; A channel containing tasks that need to be completed
   task-channel

   ;; A channel containing individual files (parts of a task) that need to be completed.
   downloads-channel

   ;; --- Runtime state ---
   ;; These are sequences of channels for each thread that's started. The threads will close the
   ;; channel when they complete. We track them so we can now when shutdown has completed
   download-thread-chs
   task-thread-chs]

  c/Lifecycle
  (start
   [this]
   (if-not task-thread-chs
     (let [downloads-channel (a/chan 5)]
       (-> this
           (assoc :downloads-channel downloads-channel)
           (assoc :task-thread-chs
                  (create-task-processing-threads provider task-channel downloads-channel))
           (assoc :download-thread-chs
                  (create-download-processing-threads s3-api provider downloads-channel))))
     this))

  (stop
   [this]
   (if task-thread-chs
     (do
       ;; Close task and downloads-channel so that waiting thread will stop
       (a/close! downloads-channel)
       (a/close! task-channel)
       ;; Wait until all the task thread channels are closed. That means the threads have completed.
       (doseq [ch task-thread-chs]
         (a/<!! ch))
       (doseq [ch download-thread-chs]
         (a/<!! ch))
       (assoc this :task-thread-chs nil))
     this)))

(defn create-task-executor
 [provider]
 (map->TaskExecutor {:provider provider}))
