(ns cumulus.provider-gateway.specs.sync-task
  (:require
   [clojure.spec.alpha :as s]
   [cumulus.provider-gateway.specs.common :as common]))


(s/def ::version string?)

;; Describes the file object that
(s/def ::file
       (s/keys :req-un [::common/url ::version]))
