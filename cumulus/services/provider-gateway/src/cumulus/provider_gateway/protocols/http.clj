(ns cumulus.provider-gateway.protocols.http
  "TODO"
  (:require
   [clj-http.client :as client]
   [clj-http.conn-mgr :as conn-mgr]
   [cumulus.provider-gateway.protocols.url-connection :as url-conn]))

(defrecord HttpConnection
  [connection-manager]

  url-conn/UrlConnection

  (close
   [conn]
   (when connection-manager
     (conn-mgr/shutdown-manager connection-manager))
   (assoc conn :connection-manager nil))

  (download
   [conn url]
   (when-not connection-manager
     (throw (Exception. "Connection not connected.")))
   (let [resp (client/get url {:connection-manager connection-manager
                               :as :stream
                               :throw-exceptions? false})]
     (if (= 200 (:status resp))
       (:body resp)
       (throw (ex-info (format "Could not download data from %s" url)
                       {:status (:status resp)
                        :body (slurp (:body resp))}))))))

(defn create-http-connection
  "TODO"
  []
  (->HttpConnection
   (conn-mgr/make-reusable-conn-manager
    {:insecure? true
     :timeout 300 ;; time in seconds that connections are left open before automatically closing.
     :threads 1
     :default-per-route 1})))


(comment
 (def sample-url
   "https://lance3.modaps.eosdis.nasa.gov/imagery/elements/VIIRS/VNGCR_NQD_C1/VNGCR_NQD_C1_r00c00/2017198/VNGCR_NQD_C1.A2017198.r00c00.001.txt")
 (def c (create-http-connection))
 (def s (url-conn/download c sample-url))
 (slurp s)
 (url-conn/close c))
