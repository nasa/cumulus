(ns cumulus.provider-gateway.specs.config
  "TODO"
  (:require
   [clojure.spec.alpha :as s]
   [cumulus.provider-gateway.specs.common :as common]))

(s/def ::skip_upload_output_payload_to_s3
       boolean?)

(s/def ::key_prefix string?)

(s/def ::output
       (s/keys :req-un [::common/bucket ::key_prefix]))

(s/def ::config
       (s/keys :opt-un [::output ::skip_upload_output_payload_to_s3]))
