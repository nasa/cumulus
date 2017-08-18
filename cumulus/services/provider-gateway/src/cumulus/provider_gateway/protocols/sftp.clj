(ns cumulus.provider-gateway.protocols.sftp
  "Defines an instance of the SFTP protocol which can download data from an SFTP server"
  (:require
   [clojure.java.io :as io]
   [cumulus.provider-gateway.protocols.url-connection :as url-conn]
   [cumulus.provider-gateway.util :as util])
  (:import
   (com.jcraft.jsch
    JSch
    Session
    ChannelSftp
    SftpException)))

(defmacro ignore-file-not-found
  [& body]
  `(try
     ~@body
     (catch SftpException e#
       ;; Ignore FileNotFoundException and return null
       (when-not (.contains (.getMessage e#) "FileNotFoundException")
         (throw e#)))))

(defrecord SftpConnection
  [
   config

   ^JSch jsch
   ^Session session
   ^ChannelSftp channel]

  url-conn/UrlConnection

  (close
   [conn]
   (when channel
     (.disconnect channel)
     (.disconnect session))
   (assoc conn :channel nil :session nil))

  (get-size
   [conn url]
   (when-not channel
     (throw (Exception. "Connection not connected.")))
   (let [path (util/url->path url)]
     (ignore-file-not-found
      (when-let [entry (first (.ls channel path))]
        (.getSize (.getAttrs entry))))))

  (download
   [conn url]
   (when-not channel
     (throw (Exception. "Connection not connected")))
   (ignore-file-not-found
    (.get channel (util/url->path url)))))


(defn create-sftp-connection
  "Creates an instance of connection to an FTP server"
  [{:keys [username password host port disable-strict-host-checking] :as config}]
  (let [jsch (JSch.)
        session (doto (.getSession jsch username host port)
                      (.setPassword password))
        _ (when disable-strict-host-checking
            ;; Makes testing easier
            (.setConfig session "StrictHostKeyChecking" "no"))
        _ (.connect session)
        channel (.openChannel session "sftp")]
    (.connect channel)
    (map->SftpConnection {:config config
                          :jsch jsch
                          :session session
                          :channel channel})))

(comment
 (def c (create-sftp-connection {:conn_type "sftp"
                                 :host "localhost"
                                 :username "ignored"
                                 :password "ignored"
                                 :disable-strict-host-checking true
                                 :port 3032}))
 (url-conn/close c)
 (url-conn/download c "sftp://localhost/foo.bar")
 (url-conn/get-size c "sftp://localhost/foo.bar")
 (url-conn/get-size c "sftp://localhost/bar.txt")
 (slurp (url-conn/download c "sftp://localhost/bar.txt"))

 (type *e))

