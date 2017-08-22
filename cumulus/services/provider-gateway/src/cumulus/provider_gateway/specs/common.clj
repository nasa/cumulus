(ns cumulus.provider-gateway.specs.common
  "Defines common specifications"
  (:require
   [clojure.spec.alpha :as s]))

(s/def ::url string?)

(s/def ::size int?)

(s/def ::bucket string?)

(s/def ::key string?)
