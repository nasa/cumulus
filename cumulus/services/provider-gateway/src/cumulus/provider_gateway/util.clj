(ns cumulus.provider-gateway.util
  "TODO"
  (:require
   [cheshire.parse :as ch-parse]
   [clojure.java.io :as io]
   [clojure.string :as str]
   [clojure.walk :as walk])
  (:import
   (com.fasterxml.jackson.dataformat.yaml
    YAMLFactory)
   (org.apache.commons.io
    FilenameUtils)))

(defmacro while-let
  "A macro that's similar to when let. It will continually evaluate the
  bindings and execute the body until the binding results in a nil value."
  [bindings & body]
  `(loop []
     (when-let ~bindings
       ~@body
       (recur))))

(defn url->file-name
  "Returns just the file name without the path from a url"
  [url]
  (let [url (io/as-url url)]
    (FilenameUtils/getName (.getPath url))))

(defn parse-yaml
  "Parses yaml using the Jackson YAMLFactory and Cheshire JSON parsing. This does not handle YAML
   tags. I could not find a way to add custom YAML tag parsing with any Java YAML parser. Snakeyaml
   comes the closest but seems to only associate YAML tags with java beans. I was not able to get
   that working and decided to skip it for now."
  [contents]
  (ch-parse/parse-strict
        (.createJsonParser (YAMLFactory.) contents)
        true nil nil))

(defn- env-vars
  "TODO"
  []
  (let [env (into {} (System/getenv))]
   (if (find-ns 'locals)
     (merge env (some-> (find-var 'locals/defaults) var-get))
     env)))

(defn get-stack-name
  []
  (get (env-vars) "STACK_NAME"))

(defn get-aws-account-id
  []
  (get (env-vars) "AWS_ACCOUNT_ID"))

(defn get-aws-region
  []
  (get (env-vars) "AWS_DEFAULT_REGION"))

(defn mustache-replace
  "Looks for pseudo-mustache patterns and replaces them using the lookup value map given."
  [lookup-value-map value]
  (let [patterns (re-seq #"\{[\w.\-]+\}" value)]
    (reduce (fn [s pattern]
              (let [lookup-path (map keyword (re-seq #"[\w\-]+" pattern))
                    replacement-value (str (get-in lookup-value-map lookup-path))]
                (str/replace s pattern replacement-value)))
            value
            (distinct patterns))))

(defn populate-message-config-replacements
  "Takes a full message and optionally a subset of that message and populates any mustache-style
   replacements anywhere in the subset."
  ([message]
   (populate-message-config-replacements message message))
  ([message message-part]
   (walk/postwalk
    (fn [value]
      (if (string? value)
        (mustache-replace message value)
        value))
    message-part)))

(defn running-in-repl?
  "TODO"
  []
  (and
   (find-ns 'user)
   (find-var 'user/system)))
