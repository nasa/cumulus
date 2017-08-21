(ns cumulus.provider-gateway.ftp-server
  "A test ftp server that can be used to test downloading data."
  (:require
   [clojure.java.io :as io])
  (:import
   (java.io
    File)
   (org.apache.ftpserver
    FtpServerFactory)
   (org.apache.ftpserver.listener
    ListenerFactory)
   (org.apache.ftpserver.usermanager.impl
    BaseUser)
   (java.nio.file
    Files)
   (java.nio.file.attribute
    FileAttribute)))

(defn default-config
  "Creates a default configuration for the FTP server. "
  []
  {:port 3022
   :username "ftp"
   :password (str (java.util.UUID/randomUUID))
   :file-paths->contents {}})

(defn- create-temp-directory
  []
  (str (Files/createTempDirectory "ftptest" (into-array FileAttribute nil))))

(defn- create-files
  [root-dir file-paths->contents]
  (doseq [[path contents] file-paths->contents
          :let [full-path (io/as-file (str root-dir path))]]
    (.mkdirs (.getParentFile full-path))
    (spit full-path contents)))

(defn start
  "Starts the ftp server and returns an instance of the server."
  [{:keys [port username password file-paths->contents] :as config}]
  (let [ftp-home (create-temp-directory)
        listener-factory (doto (ListenerFactory.)
                               (.setPort port))
        factory (doto (FtpServerFactory.)
                      (.addListener "default" (.createListener listener-factory)))
        user (doto (BaseUser.)
                   (.setName username)
                   (.setPassword password)
                   (.setHomeDirectory ftp-home))
        _ (.save (.getUserManager factory) user)
        server (.createServer factory)]
    (.start server)
    (create-files ftp-home file-paths->contents)
    (assoc config
           :ftp-home ftp-home
           :server server)))

(defn stop
  "Stops the server and returns it."
  [{:keys [server ftp-home] :as config}]
  (when server
    (.stop server))
  (when ftp-home
    (.delete (io/as-file ftp-home)))
  (dissoc config :ftp-home :server))


(defn create-run-ftp-fixture
  "A fixture which runs an FTP server.
   * var - a var which will have the server set on it so that access to username, port, and password
   is possible during a test.
   * options - Any options for running the FTP server. See default-config for valid options."
  [var options]
  (fn [f]
   (let [config (merge (default-config) options)
         server (start config)]
     (try
       (alter-var-root var (constantly server))
       (f)
       (finally
         (stop server)
         (alter-var-root var (constantly nil)))))))

(comment
 (def cfg (assoc (default-config)
                 :file-paths->contents cumulus.provider-gateway.integration-test/files->content))
 (def f (start cfg))
 (stop f)
 (:password f))
