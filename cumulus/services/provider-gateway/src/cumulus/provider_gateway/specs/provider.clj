(ns cumulus.provider-gateway.specs.provider
  "Defines specifications for provider configuration."
  (:require
   [clojure.spec.alpha :as s]
   [cumulus.provider-gateway.specs.common :as common]))

;;;;
;; Provider Activity api configuration

(s/def ::activity-api-type string?)
(defmulti activity-api-type :activity-api-type)

(s/def ::dir string?)

(defmethod activity-api-type "file-system"
  [_]
  (s/keys :req-un [::activity-api-type ::dir]))

(s/def ::canned-tasks (s/coll-of map?))
(s/def ::tasks ::canned-tasks)

(defmethod activity-api-type "canned"
  [_]
  (s/keys :req-un [::activity-api-type ::tasks]))

(defmethod activity-api-type "aws"
  [_]
  (s/keys :req-un [::activity-api-type]))

(defmethod activity-api-type :default
  [value]
  (throw (Exception. (str "Invalid api type in " value))))


(s/def ::activity-api
       (s/multi-spec activity-api-type ::activity-api-type))
;;;;
;; Provider Connection config
(s/def ::conn_type string?)
(defmulti connection-type :conn_type)

(s/def ::host string?)
(s/def ::port int?)
(s/def ::username string?)
(s/def ::password string?)

(defmethod connection-type "ftp"
  [_]
  (s/keys :req-un [::conn_type ::host]
          :opt-un [::port ::username ::password]))

(defmethod connection-type "http"
  [_]
  ;; HTTP doesn't really have any configuration
  (s/keys :req-un [::conn_type]))

(defmethod connection-type :default
  [value]
  (throw (Exception. (str "Invalid connection type in " value))))

(s/def ::conn_config (s/multi-spec connection-type ::conn_type))

;;;;
;; The Provider Spec
(s/def ::provider-id string?)
(s/def ::num_connections int?)
(s/def ::sync-activity-api ::activity-api)

(s/def ::provider
       (s/keys :req-un [::provider-id ::conn_config ::num_connections]
               :opt-un [::activity-api ::sync-activity-api]))
