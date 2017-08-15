(ns cumulus.provider-gateway.specs.task
  "TODO"
  (:require
   [clojure.spec.alpha :as s]
   [cumulus.provider-gateway.specs.common :as common]
   [cumulus.provider-gateway.specs.config :as config]))


(s/def ::source
       (s/keys :req-un [::url]
               :opt-un [::size]))

(s/def ::target
       (s/or
         :from-config #(= % "FROM_CONFIG")
         :s3-bucket-key (s/keys :req-un [::common/bucket ::common/key])))

(s/def ::type #{"download"})

(s/def ::request
       (s/keys :req-un [::type ::source ::target]))

(s/def ::files
       (s/coll-of ::request))

(s/def ::payload
       (s/keys :req-un [::files]))

; (s/def ::payload-maybe-in-s3
;        (s/or
;         :payload-in-s3 (s/keys :req-un [::Bucket ::Key])
;         :payload ::payload))

(s/def ::task-token string?)
(s/def ::input ::payload)

;; This is the task when it arrives to the task executor
(s/def ::task
       (s/keys :req-un [::config/config
                        ::task-token
                        ::input]))
