(ns cumulus.provider-gateway.sftp-server
  (:require
   [clojure.java.io :as io])
  (:import
   (java.nio.file
    Files)
   (java.nio.file.attribute
    FileAttribute)
   (org.apache.sshd.server
    SshServer)
   (org.apache.sshd.common.file.virtualfs
    VirtualFileSystemFactory)
   (org.apache.sshd.server.auth.password
    UserAuthPasswordFactory
    AcceptAllPasswordAuthenticator)
   (org.apache.sshd.server.scp
    ScpCommandFactory)
   (org.apache.sshd.server.keyprovider
    SimpleGeneratorHostKeyProvider)
   (org.apache.sshd.server.subsystem.sftp
    SftpSubsystemFactory$Builder)))

(defn default-config
  "Creates a default configuration for the sFTP server. "
  []
  {:port 3032
   :file-paths->contents {}})

(defn- create-temp-directory
  []
  (Files/createTempDirectory "sftptest" (into-array FileAttribute nil)))

(defn- create-files
  [root-dir file-paths->contents]
  (doseq [[path contents] file-paths->contents
          :let [full-path (io/as-file (str root-dir "/" path))]]
    (.mkdirs (.getParentFile full-path))
    (spit full-path contents)))

(defn start
  "Starts the sftp server and returns an instance of the server."
  [{:keys [port file-paths->contents] :as config}]
  (let [ftp-home (create-temp-directory)
        server (doto
                (SshServer/setUpDefaultServer)
                (.setFileSystemFactory (VirtualFileSystemFactory. ftp-home))
                (.setPort port)
                (.setKeyPairProvider (SimpleGeneratorHostKeyProvider. (io/as-file "my.pem")))
                (.setCommandFactory (ScpCommandFactory.))
                (.setUserAuthFactories [UserAuthPasswordFactory/INSTANCE])
                (.setPasswordAuthenticator AcceptAllPasswordAuthenticator/INSTANCE)
                (.setSubsystemFactories [(.build (SftpSubsystemFactory$Builder.))]))]
    (create-files (str ftp-home) file-paths->contents)
    (.start server)
    (assoc config
           :ftp-home (str ftp-home)
           :server server)))

(defn stop
  "Stops the server and returns it."
  [{:keys [server ftp-home] :as config}]
  (when server
    (.stop server))
  (when ftp-home
    (.delete (io/as-file ftp-home)))
  (dissoc config :ftp-home :server))


(defn create-run-sftp-fixture
  "A fixture which runs an SFTP server.
   * var - a var which will have the server set on it so that access to username, port, and password
   is possible during a test.
   * options - Any options for running the SFTP server. See default-config for valid options."
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
 (def s (start (assoc (default-config)
                      :file-paths->contents {"bar.txt" "bar bar bar"})))
 (stop s))

