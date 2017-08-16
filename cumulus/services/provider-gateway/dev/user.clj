(ns user
  (:require
   [clojure.pprint :refer (pprint pp)]
   [clojure.tools.namespace.repl :as tnr]
   [clojure.spec.alpha :as s]
   [cheshire.core :as json]
   [com.stuartsierra.component :as c]
   [cumulus.provider-gateway.system :as sys]
   [cumulus.provider-gateway.util :as util]
   [proto-repl.saved-values]))

(def local-activity-dir
  "./local_activities")

(def local-provider
  {:provider-id "LOCAL",
   :activity-api {:activity-api-type "file-system"
                  :dir local-activity-dir}
   ; :conn_config {:conn_type "http"}
   :conn_config {:conn_type "ftp"
                 :host "localhost"
                 :username "ftp"
                 :password "ftp"}
   :num_connections 2})

(def system nil)

(defn start []
  (set! *print-length* 5000)
  (s/check-asserts true)
  (try
    (let [
          the-system (sys/create-system [local-provider])]
          ; the-system (sys/create-system)]
      (alter-var-root #'system
                      (constantly (c/start the-system))))
    (catch Exception e
      (.printStackTrace e)
      (throw e)))
  nil)

(defn stop []
  (try
    (alter-var-root #'system #(when % (c/stop %)))
    (catch Exception e
      (.printStackTrace e)
      (throw e)))
  nil)

(defn reset []
  (stop)
  (tnr/refresh :after 'user/start))

(println "Custom user.clj loaded.")

