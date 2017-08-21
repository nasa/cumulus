(ns cumulus.provider-gateway.runner
  "Entry point for the application. Defines a main method that accepts arguments."
  (:require
   [clojure.pprint :as pp]
   [clojure.spec.alpha :as s]
   [com.stuartsierra.component :as c]
   [cumulus.provider-gateway.system :as sys])
  (:gen-class))

(defn -main
  "Starts the App."
  [& args]

  ;; Enable Clojure Spec assertions so we can find problems when running in our development environments
  ;; Performance Note: Disable this when performance matters. The actual overhead it adds may not
  ;; be much though
  (s/check-asserts true)

  (pp/pprint (into {} (System/getenv)))
  (c/start (sys/create-system))
  (println "Running...")
  ;; run it forever
  (.join (Thread/currentThread)));

