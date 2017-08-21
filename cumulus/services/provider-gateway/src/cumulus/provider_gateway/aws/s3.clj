(ns cumulus.provider-gateway.aws.s3
  "Defines protocols and functions for accessing AWS S3 or stubbed implementations"
  (:require
   [amazonica.aws.s3 :as s3]
   [cheshire.core :as json])
  (:import
   (com.amazonaws.services.s3.model
    AmazonS3Exception)))

(defprotocol S3Api
  "Defines an API for the kinds of requests we need to make to S3."
  (read-s3-string
   [this bucket key]
   "Reads a string from the given s3 bucket and key")

  (write-s3-string
   [this bucket key value]
   [this bucket key value metadata]
   "Writes a string to the given s3 bucket and key")

  (write-s3-stream
   [this bucket key stream]
   [this bucket key stream metadata]
   "Writes a stream to the given s3 bucket and key")

  (get-s3-object-metadata
   [this bucket key]
   "Returns a map of metadata for the given object and key. Returns nil if it doesn't exist"))

(defmulti create-s3-api
  "Creates an instance of the AWS API for use."
  (fn [type]
    type))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; AWS impl

(def aws-s3-api
  "Default implementation of the S3 API that talks to the real S3"
  (reify
   S3Api

   (read-s3-string
    [_ bucket key]
    (slurp (:input-stream (s3/get-object bucket key))))

   (write-s3-stream
    [this bucket key stream]
    (write-s3-stream this bucket key stream nil))

   (write-s3-stream
    [_ bucket key stream metadata]
    (s3/put-object :bucket-name bucket
                   :key key
                   :input-stream stream
                   :metadata metadata))

   (write-s3-string
    [this bucket key value]
    (write-s3-string this bucket key value nil))

   (write-s3-string
    [this bucket key value metadata]
    (let [bytes (.getBytes value "UTF-8")
          is (java.io.ByteArrayInputStream. bytes)]
      (write-s3-stream this bucket key is (merge {:content-length (count bytes)} metadata))))

   (get-s3-object-metadata
    [_ bucket key]
    (try
      (s3/get-object-metadata :bucket-name bucket :key key)
      (catch AmazonS3Exception e
        ;; Ignore exception and return nil if not found.
        (when-not (.startsWith (.getMessage e) "Not Found")
          (throw e)))))))

(defmethod create-s3-api :aws
  [_]
  ;; same instance is used for all of them
  aws-s3-api)

;; No type specified defaults to AWS
(defmethod create-s3-api nil
  [_]
  (create-s3-api :aws))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; InMemory data
;; Used for testing so we can test code that works with S3 without actually connecting to it..

(defrecord InMemoryS3API
  ;; nested maps of bucket -> key -> {:metadata ... :value ...}
  [bucket-key-to-value-atom]

  S3Api
  (read-s3-string
   [_ bucket key]
   (get-in @bucket-key-to-value-atom [bucket key :value]))

  (write-s3-string
   [this bucket key value]
   (write-s3-string this bucket key value nil))

  (write-s3-string
   [_ bucket key value metadata]
   (swap! bucket-key-to-value-atom #(assoc-in % [bucket key] {:value value :metadata metadata})))

  (write-s3-stream
   [this bucket key stream]
   (write-s3-stream this bucket key stream nil))

  (write-s3-stream
   [this bucket key stream metadata]
   (write-s3-string this bucket key (slurp stream) metadata))

  (get-s3-object-metadata
   [_ bucket key]
   (get-in @bucket-key-to-value-atom [bucket key :metadata])))

(defn create-in-memory-s3-api
  "Creates an instance of the in-memory s3 api. Takes an existing map of data in S3 of buckets to keys
   to values"
  ([]
   (create-in-memory-s3-api {}))
  ([existing-data]
   (->InMemoryS3API (atom existing-data))))

(defmethod create-s3-api :in-memory
  [_]
  ;; same instance is used for all of them
  (create-in-memory-s3-api))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; Helper functions

(defn read-s3-json
  "Reads a string from the given s3 bucket and key"
  ([bucket key]
   (read-s3-json aws-s3-api bucket key))
  ([s3-api bucket key]
   (json/decode (read-s3-string s3-api bucket key) true)))

(defn write-s3-json
  "Reads a string from the given s3 bucket and key"
  ([bucket key value]
   (write-s3-json aws-s3-api bucket key value))
  ([s3-api bucket key value]
   (write-s3-string s3-api bucket key (json/generate-string value {:pretty true}))))
