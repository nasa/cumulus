(ns cumulus.provider-gateway.system
  "TODO"
  (:require
   [clojure.spec.alpha :as s]
   [clojure.core.async :as a]
   [clojure.string :as str]
   [com.stuartsierra.component :as c]
   [cumulus.provider-gateway.aws.activity-api :as activity]
   [cumulus.provider-gateway.activities.sync-task-to-request-handler :as strh]
   [cumulus.provider-gateway.activity-handler :as activity-handler]
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
  "TODO"
  5)

(defn create-activity-arn
  [activity-name-or-arn]
  (if (.startsWith activity-name-or-arn "arn:aws")
    activity-name-or-arn
    (let [arn-name (str/replace activity-name-or-arn #"Activity$" "")]
      (format "arn:aws:states:%s:%s:activity:%s-%s"
              (util/get-aws-region)
              (util/get-aws-account-id)
              (util/get-stack-name)
              arn-name))))

(defn get-gateway-providers
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
                (when (:activity_arn config)
                  {:activity-api {:type :aws
                                  :arn (create-activity-arn (:activity_arn config))}})
                (when (:sync_activity_arn config)
                  {:sync-activity-api {:type :aws
                                       :arn (create-activity-arn (:sync_activity_arn config))}})))))))

(defn create-provider-components
  "TODO"
  [provider]
  (s/assert ::provider-spec/provider provider)
  (let [;; helper function for making a keyword with a provider id prefix.
        pk #(keyword (str (:provider-id provider) "-" (name %)))]

    (merge
     ;; TODO Add comments before each key documenting what it si.
     {(pk :task-channel) (a/chan TASK_CHANNEL_BUFFER_SIZE)

      (pk :s3-api) (s3/create-s3-api (:s3-api-type provider))

      (pk :task-executor) (c/using (task-executor/create-task-executor provider)
                                   {:task-channel (pk :task-channel)
                                    :s3-api (pk :s3-api)})}

     (when (:activity-api provider)
       ;; TODO rename request activity api in configuration to download-request or something with download in the name
       ;; Create an activity handler just for normal requests
       {(pk :activity-handler) (c/using (activity-handler/create-activity-handler
                                         (activity/create-activity-api (:activity-api provider)))
                                        {:task-channel (pk :task-channel)})})

     (when (:sync-activity-api provider)
       ;; Create a sync activity handler
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
