(ns cumulus.provider-gateway.http-server
  "Defines an HTTP server for testing downloading data over HTTP."
  (:require
   [clj-http.client :as http]
   [clojure.test :refer :all]
   [ring.adapter.jetty :as jetty]))

(def DEFAULT_PORT 3001)

(defn default-config
  "Creates a default configuration for the HTTP server. "
  []
  {:port 3001
   :file-paths->contents {}})

(defn serve-content
  [file-paths->contents {:keys [uri]}]
  (if-let [content (file-paths->contents uri)]
    {:status 200 :body content}
    {:status 404 :body "Not Found"}))

(defn start-jetty
  [{:keys [port file-paths->contents] :as config}]
  (assoc config
         :server (jetty/run-jetty #(serve-content file-paths->contents %)
                                  {:port port :join? false})))

(defn create-run-jetty-fixture
  "A fixture which runs an HTTP server.
   * var - a var which will have the server set on it so that access to port.
   * options - Any options for running the HTTP server. See default-config for valid options."
  [var options]
  (let [config (merge (default-config) options)]
    (fn [f]
      (let [server (start-jetty config)]
        (alter-var-root var (constantly server))
        (try
          (f)
          (finally
            (.stop (:server server))
            (alter-var-root var (constantly nil))))))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; Testing the server

(def http-files->content
  {"/foo/bar.txt" "bar bar bar"
   "/moo.txt" "cows say this"})

(def http-server
  nil)

(use-fixtures :once (create-run-jetty-fixture #'http-server
                                              {:file-paths->contents http-files->content}))

(deftest test-jetty-fixture
  (testing "Content is available"
    (doseq [[uri content] http-files->content]
      (is (= content (:body (http/get (str "http://localhost:" DEFAULT_PORT uri)))))))
  (testing "Var is set"
    (is (some? http-server))
    (is (= DEFAULT_PORT (:port http-server)))))
