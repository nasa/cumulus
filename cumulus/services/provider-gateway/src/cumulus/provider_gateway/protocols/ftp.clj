(ns cumulus.provider-gateway.protocols.ftp
  "Defines an instance of the FTP protocol which can download data from an FTP server"
  (:require
   [clojure.java.io :as io]
   [cumulus.provider-gateway.protocols.url-connection :as url-conn])
  (:import
   (java.io
    FilterInputStream)
   (org.apache.commons.net.ftp
    FTP
    FTPConnectionClosedException
    FTPFile
    FTPReply
    FTPClient)))

(defn- check-reply
  "Checks that the reply from the server for the last request was successful."
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

(defn- connect-client
  "Takes an existing FTP client and configures and connects to the FTP server."
  [config client]
  (let [{:keys [host port username password]} config
        port (or port 21)]
    (println (format "Connecting to FTP server [%s] on port [%d] using user [%s] password [%s]"
                     host
                     port
                     username
                     password))
    (.setControlEncoding client "UTF-8")
    ;; The following line was added to fix an issue (GITC-455) when connecting to FTP servers
    ;; using extended passive mode (EPSV) from AWS ECS containers. This may cause problems
    ;; if the FTP server is not using EPSV.
    (.setUseEPSVwithIPv4 client true)
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
  "Creates an connects and instance of an FTP Client"
  [config]
  (connect-client config (FTPClient.)))


(comment
 (def c (create-ftp-connection
         {:host "localhost"
          :username "ftp"
          :password "ftp"}))

 (map #(.getSize %) (seq (.listFiles (:client c) "/PDR/PDN.ID1703251200.PD2R")))

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

   ^FTPClient client]

  url-conn/UrlConnection

  (close
   [conn]
   (when (and client (.isConnected client))
     (try (.logout client) (catch FTPConnectionClosedException _ nil))
     (try (.disconnect client) (catch FTPConnectionClosedException _ nil)))
   (assoc conn :client nil))

  (get-size
   [conn url]
   (when-not client
     (throw (Exception. "Connection not connected.")))
   (let [path (.getPath (io/as-url url))]
     (when-let [^FTPFile ftp-file (first (.listFiles client path))]
       (.getSize ftp-file))))

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
  "Creates an instance of connection to an FTP server"
  [config]
  (map->FtpConnection {:config config :client (create-ftp-client config)}))




