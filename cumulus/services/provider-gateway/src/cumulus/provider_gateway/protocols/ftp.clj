(ns cumulus.provider-gateway.protocols.ftp
  "TODO"
  (:require
   [clojure.java.io :as io]
   [cumulus.provider-gateway.protocols.url-connection :as url-conn])
  (:import
   (java.io
    FilterInputStream)
   (org.apache.commons.net.ftp
    FTP
    FTPConnectionClosedException
    FTPReply
    FTPClient)))

(defn- check-reply
  "TODO"
  [client]
  (let [reply (.getReplyCode client)]
    (when-not (FTPReply/isPositiveCompletion reply)
      (.disconnect client)
      (throw (Exception. "Last command did not complete successfully")))))

(defn- safe-close-connection
  "Catches any exceptions when trying to close the connection"
  [conn]
  (try
    (url-conn/close conn)
    (catch Exception _
      conn)))

;; TODO the connections will timeout if not used (It seems like.)
;; Figure out how to handle that.
;;  FTPConnectionClosedException FTP response 421 received.

(defn- connect-client
  [config client]
  (let [{:keys [host port username password]} config
        port (or port 21)]
    (.setControlEncoding client "UTF-8")
    (.setConnectTimeout client 30000) ; ms
    (.setDataTimeout client -1) ; forever ms
    (.setControlKeepAliveTimeout client 300) ; seconds
    (.setControlKeepAliveReplyTimeout client 3000) ; ms

    ;; Connect and check reply code to verify success
    (.connect client host port)
    (check-reply client)

    (when username
      (when-not (.login client username password)
        (.disconnect client)
        (throw (Exception. (format "Unable to login with username [%s] and password [****]"
                                   username)))))
    (.setFileType client FTP/BINARY_FILE_TYPE)
    (.enterLocalPassiveMode client)
    client))

(defn- create-ftp-client
  "TODO"
  [config]
  (connect-client config (FTPClient.)))


(comment
 (def c (create-ftp-connection
         {:host "localhost"
          :username "ftp"
          :password "ftp"}))
 (def s (url-conn/download c "ftp://localhost/PDR/PDN.ID1703251200.PDR"))

 ;; returns nil if it doesn't exist
 (def s (url-conn/download c "ftp://localhost/foo.txt"))

 (slurp s)
 (.isConnected (:client c))
 (url-conn/close c))

(defn retrieve-file-stream
  [config client path]
  (try
    (.retrieveFileStream client path)
    (catch FTPConnectionClosedException e
      (println "Detected a closed FTP connection. Attempting to reconnect")
      (connect-client config client)
      (println "Reconnect success")
      (.retrieveFileStream client path))))

(defrecord FtpConnection
  [
   config

   client]

  url-conn/UrlConnection

  (close
   [conn]
   (when (and client (.isConnected client))
     (try (.logout client) (catch FTPConnectionClosedException _ nil))
     (try (.disconnect client) (catch FTPConnectionClosedException _ nil)))
   (assoc conn :client nil))

  (download
   [conn url]
   (when-not client
     (throw (Exception. "Connection not connected")))
   (let [path (.getPath (io/as-url url))
         closed (atom false)]
     (when-let [stream (retrieve-file-stream config client path)]
       ;; Return a non-closing FilterInputStream. Closing the stream returned by filter
       ;; retrieveFileStream closes the whole connection.
       (proxy
        [FilterInputStream]
        [^InputStream stream]
        (close
         []
         (when-not @closed
           (try
             ;; When we're done with the stream as indicated by the user calling close we use
             ;; completePendingCommand to verify success of the action and indicate that we're done.
             (if (.completePendingCommand client)
               (check-reply client)
               ;; There was a problem. Close the connection and throw exception.
               (do
                 (safe-close-connection conn)
                 (throw (Exception. "Could not complete pending command of downloaded stream"))))
             (finally
               (reset! closed true))))))))))

(defn create-ftp-connection
  "TODO"
  [config]
  (map->FtpConnection {:config config :client (create-ftp-client config)}))




