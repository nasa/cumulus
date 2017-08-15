(ns cumulus.provider-gateway.specs.common
  "TODO"
  (:require
   [clojure.spec.alpha :as s]))

(s/def ::url string?)

(s/def ::size int?)

(s/def ::bucket string?)

(s/def ::key string?)


;; Upper case aliases because the other parts of gibs use upper case for this in a payload in S3.
; (s/def ::Bucket ::bucket)
; (s/def ::Key ::key)
;
