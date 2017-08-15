(ns cumulus.provider-gateway.aws.activity-api
  "Defines an API for talking to the AWS Step Function Activity API in AWS or other substitute
   instances."
  (:require
   [clojure.spec.alpha :as s]
   [amazonica.aws.stepfunctions :as sf]
   [clojure.java.io :as io]
   [cheshire.core :as json])
  (:import
   (com.amazonaws.http.timers.client
    ClientExecutionTimeoutException)
   (java.io
    File)
   (java.net
    URI)
   (java.nio.file
    FileSystems
    Paths
    StandardWatchEventKinds
    WatchEvent$Kind)))

(defprotocol ActivityProtocol
  "Defines a protocol for mimics the AWS activity API."

  (get-task
   [this]
   "Returns a task which is a group of download or upload requests to complete. Blocks for a certain
   period of time. Returns null if there are no tasks found within a period of time.")

  (report-task-failure
   [this task-token error-code cause]
   "Reports a failure to execute the activity")

  (report-task-success
   [this task-token output]
   "Reports a successful activity execution. The output should be a JSON string to pass to the next
    step of the step function."))

(defmulti create-activity-api
  (fn [config]
    (:activity-api-type config)))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; Canned implementation

;; In memory implementation of the activity API for testing.
(defrecord CannedActivities
  [
   ;; An atom containing a sequence of tasks. Requests to get a task will take from the atom.
   tasks-atom

   ;; A map of task token to the results
   failed-tasks-atom

   ;; A map of successful task ids to the output found.
   successful-tasks-atom]

  ActivityProtocol

  (get-task
   [this]
   (let [val-to-return (atom nil)]
     (swap! tasks-atom (fn [tasks]
                         (reset! val-to-return (first tasks))
                         (rest tasks)))
     (or @val-to-return
         ;; Simulate blocking call to wait for more data
         (do (Thread/sleep 1000) nil))))

  (report-task-failure
   [this task-token error-code cause]
   (swap! failed-tasks-atom assoc task-token {:error-code error-code :cause cause})
   nil)

  (report-task-success
   [this task-token output]
   (swap! successful-tasks-atom assoc task-token output)
   nil))

(defn create-canned-activities
  [tasks]
  (map->CannedActivities {:tasks-atom (atom tasks)
                          :failed-tasks-atom (atom {})
                          :successful-tasks-atom (atom {})}))

(defmethod create-activity-api "canned"
  [config]
  (create-canned-activities (:tasks config)))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; AWS implementation

(def POLL_TIMEOUT
  "The length of time in milliseconds to poll the activity API for an activity to run before timing
   out. AWS recommends setting this at 65 seconds."
  65000)

;; Implements the ActivityProtocol against the real AWS API.
(defrecord AwsActivityApi
  [activity-arn]

  ActivityProtocol

  (get-task
   [this]
   (try
     (println "Reading task from" activity-arn)
     (let [task (sf/get-activity-task {:activity-arn activity-arn
                                       :sdk-client-execution-timeout POLL_TIMEOUT})
           _ (println "Task read" (pr-str task))
           {:keys [task-token input]} task]
       {:task-token task-token
        :input (json/decode input true)})
     (catch ClientExecutionTimeoutException e
       ;; ignoring this and returning nil
       nil)))

  (report-task-failure
   [this task-token error-code cause]
   (println "Reporting failure" task-token error-code cause)
   (sf/send-task-failure {:taskToken task-token :errorCode error-code :cause cause})
   nil)

  (report-task-success
   [this task-token output]
   (println "Reporting success" task-token)
   (sf/send-task-success {:output (json/encode output) :taskToken task-token})
   nil))

(defn create-aws-activity-api
  "Creates an instance of the AWS implementation of the ActivityProtocol"
  [activity-arn]
  (->AwsActivityApi activity-arn))

(defmethod create-activity-api "aws"
  [config]
  (create-aws-activity-api (:arn config)))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; Folder implementation

(defn ensure-dir-exists
  [dir]
  (let [f (io/as-file dir)]
    (when-not (.exists f)
      (.mkdirs f))))

(defn get-oldest-input-file
  "Tries to find the oldest input file in the input directory. If it can not find a file waits for
   a period of time for a file to show up."
  [input-dir watch-service]

  (or
   ;; Look for existing files in the directory.
   (->> (.listFiles input-dir)
        (filter #(.isFile %))
        (sort-by #(.lastModified %))
        first)

   ;; If not existing files in the directory then use the watch service to wait up to N seconds
   ;; for a file to arrive
   (when-let [event-key (.poll watch-service 10 java.util.concurrent.TimeUnit/SECONDS)]
     (try
       (let [event (first (.pollEvents event-key))]
         (io/as-file (str input-dir File/separator (.context event))))
       (finally
         (.reset event-key))))))

;; Implements the ActivityProtocol using the file system. Reads from a <target-dir>/inputs and
;; writes to <target-dir>/outputs
(defrecord FileSystemActivityApi
  [
   ;; An atom containing a number to use to generate unique task tokens
   task-token-atom

   ;; Java NIO watch service against the input dir to look for new files
   watch-service

   ;; Directory monitored for new tasks to execute
   input-dir

   ;; Successful task output will be written as new files to this directory.
   output-dir]

  ActivityProtocol

  (get-task
   [this]
   (ensure-dir-exists input-dir)

   (when-let [oldest-input-file (get-oldest-input-file input-dir watch-service)]
     (let [contents (json/decode (slurp oldest-input-file) true)
           task-token (str "task-" (swap! task-token-atom inc))]
       (println "Task read" (pr-str contents))
       (when-not (.delete oldest-input-file)
         (throw (Exception. (str "Could not delete input file " oldest-input-file))))
       {:task-token task-token
        :input contents})))

  (report-task-failure
   [this task-token error-code cause]
   (println "Task Failure:" (pr-str {:taskToken task-token :errorCode error-code :cause cause})))

  (report-task-success
   [this task-token output]
   (println "Reporting success" task-token)
   (ensure-dir-exists output-dir)
   (let [output-file (io/as-file (str output-dir File/separator task-token ".json"))]
     (spit output-file (json/encode output {:pretty true})))
   nil))

(defn create-file-system-activity-api
  [target-dir]
  (let [input-dir (io/as-file (str target-dir File/separator "inputs"))
        output-dir (io/as-file (str target-dir File/separator "outputs"))
        watch-service (.newWatchService (FileSystems/getDefault))
        path (Paths/get (URI. (str (io/as-url input-dir))))]
    (.register path watch-service (into-array WatchEvent$Kind [StandardWatchEventKinds/ENTRY_CREATE]))
    (map->FileSystemActivityApi {:task-token-atom (atom 0)
                                 :watch-service watch-service
                                 :input-dir input-dir
                                 :output-dir output-dir})))

(defmethod create-activity-api "file-system"
  [config]
  (create-file-system-activity-api (:dir config)))