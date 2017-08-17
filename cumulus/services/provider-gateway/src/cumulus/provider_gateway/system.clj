(ns cumulus.provider-gateway.system
  "Defines the running system."
  (:require
   [clojure.spec.alpha :as s]
   [clojure.core.async :as a]
   [clojure.string :as str]
   [com.stuartsierra.component :as c]
   [cumulus.provider-gateway.aws.activity-api :as activity]
   [cumulus.provider-gateway.activities.sync-task-to-request-handler :as strh]
   [cumulus.provider-gateway.download-activity-handler :as activity-handler]
   [cumulus.provider-gateway.task-executor :as task-executor]
   [cumulus.provider-gateway.util :as util]
   [cumulus.provider-gateway.specs.provider :as provider-spec]
   [cumulus.provider-gateway.aws.s3 :as s3]))

(def COLLECTIONS_YAML
  "The location of the collection yaml file within the deploy bucket"
  "ingest/collections.yml")

(defn load-collections-config
  ([]
   (load-collections-config (util/get-stack-name)))
  ([stack-name]
   (util/parse-yaml (s3/read-s3-string s3/aws-s3-api
                                       (str stack-name "-deploy") COLLECTIONS_YAML))))

(def TASK_CHANNEL_BUFFER_SIZE
  "The number of messages that can be buffered in the download task channel before writing to it will
   be blocked. There's a task channel per provider."
  5)

(defn create-activity-arn
  [activity-name]
  (format "arn:aws:states:%s:%s:activity:%s-%s"
          (util/get-aws-region)
          (util/get-aws-account-id)
          (util/get-stack-name)
          activity-name))

(defn get-gateway-providers
  "Returns the set of providers configured in collections.yml"
  ([]
   (get-gateway-providers (load-collections-config)))
  ([config]
   (->> config
        :providers
        ;; Get all the providers with a gateway config
        (filter #(get-in % [:config :gateway_config]))

        (map (fn [{id :id
                   {config :gateway_config} :config}]
               (merge
                {:provider-id id}
                (select-keys config [:conn_config :num_connections])
                (when (:activity config)
                  {:activity-api {:activity-api-type "aws"
                                  :arn (create-activity-arn (:activity config))}})
                (when (:sync_activity config)
                  {:sync-activity-api {:activity-api-type "aws"
                                       :arn (create-activity-arn (:sync_activity config))}})))))))

(defn create-provider-components
  "Takes a configured provider and creates system components prefixed with the providers id so they
   won't conflict with components for other providers."
  [provider]
  (s/assert ::provider-spec/provider provider)
  (let [;; helper function for making a keyword with a provider id prefix.
        pk #(keyword (str (:provider-id provider) "-" (name %)))]

    (merge
     {;; A channel for communicating task read from the activity API to the task executor
      (pk :task-channel) (a/chan TASK_CHANNEL_BUFFER_SIZE)

      ;; The implementation of the S3 API to use.
      (pk :s3-api) (s3/create-s3-api (:s3-api-type provider))

      ;; The task executor processes download requests for a provider.
      (pk :task-executor) (c/using (task-executor/create-task-executor provider)
                                   {:task-channel (pk :task-channel)
                                    :s3-api (pk :s3-api)})}

     ;; Create an activity handler that downloads requests
     (when (:activity-api provider)
       {(pk :download-activity-handler) (c/using (activity-handler/create-activity-handler
                                                  (activity/create-activity-api (:activity-api provider)))
                                                 {:task-channel (pk :task-channel)})})

     ;; Create a sync activity handler
     (when (:sync-activity-api provider)
       {(pk :sync-activity-handler)
        (c/using (activity-handler/create-activity-handler
                  (activity/create-activity-api (:sync-activity-api provider))
                  (strh/create-sync-task-to-request-handler))
                 {:task-channel (pk :task-channel)})}))))

(defn create-system
  "Creates a new instance of the message store system."
  ([]
   (create-system (get-gateway-providers)))
  ([providers]
   (println "Using provider config" (pr-str providers))
   (let [provider-components (->> providers
                                  (map create-provider-components)
                                  (reduce (fn [vals provider-entries]
                                            (reduce into vals provider-entries))
                                          []))]

     (apply
      c/system-map
      provider-components))))
