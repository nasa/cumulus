(defproject nasa-cumulus/provider-gateway "0.1.0-SNAPSHOT"
  :description "FIXME: write description"
  :url "http://example.com/FIXME"
  :dependencies [[org.clojure/clojure "1.9.0-alpha17"]
                 [com.stuartsierra/component "0.3.2"]
                 [org.clojure/core.async "0.3.443"]
                 [amazonica "0.3.107"]
                 [cheshire "5.7.1"]
                 [clj-http "3.6.1"]
                 [commons-net/commons-net "3.6"]
                 [org.yaml/snakeyaml "1.18"]
                 [com.fasterxml.jackson.dataformat/jackson-dataformat-yaml "2.8.9"]]


  ;; The ^replace is done to disable the tiered compilation for accurate benchmarks
  ;; See https://github.com/technomancy/leiningen/wiki/Faster
  :jvm-opts ^:replace ["-server"
                       "-Dclojure.compiler.direct-linking=true"]

  :profiles {:dev {:dependencies [[org.clojure/tools.namespace "0.2.11"]
                                  [criterium "0.4.4"]
                                  [proto-repl "0.3.1"]
                                  [pjstadig/humane-test-output "0.8.2"]

                                  ;; HTTP server for testing
                                  [ring/ring-jetty-adapter "1.5.0"]
                                  ;; FTP server for testing
                                  [org.apache.ftpserver/ftpserver-core "1.1.1"]]
                   :jvm-opts ^:replace ["-server"]
                               ;; Uncomment this to enable assertions. Turn off during performance tests.
                               ; "-ea"

                               ;; Use the following to enable JMX profiling with visualvm
                               ; "-Dcom.sun.management.jmxremote"
                               ; "-Dcom.sun.management.jmxremote.ssl=false"
                               ; "-Dcom.sun.management.jmxremote.authenticate=false"
                               ; "-Dcom.sun.management.jmxremote.port=1098"]
                   :source-paths ["src" "dev" "test"]
                   :injections [(require 'pjstadig.humane-test-output)
                                (pjstadig.humane-test-output/activate!)]}
             :uberjar {:main cumulus.provider-gateway.runner
                       :aot :all}})
