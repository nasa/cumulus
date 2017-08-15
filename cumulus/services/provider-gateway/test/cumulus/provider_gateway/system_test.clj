(ns cumulus.provider-gateway.system-test
  (:require
   [clojure.test :refer :all]
   [cumulus.provider-gateway.system :as sys]
   [cumulus.provider-gateway.util :as util]))

(deftest get-gateway-providers
  (let [sample-config {:providers [{:id "MODAPS"
                                    :config
                                    {:gateway_config
                                     {:activity_arn "MODAPSProviderGatewayActivity"
                                      :sync_activity_arn "MODAPSSyncActivity"
                                      :conn_config {:type "http"}
                                      :num_connections 10}}}
                                   {:id "LARC" :config {}}]}
        arn-prefix (format "arn:aws:states:%s:%s:activity:%s-"
                           (util/get-aws-region)
                           (util/get-aws-account-id)
                           (util/get-stack-name))]
    (is (= [{:activity-api {:type :aws
                            :arn (str arn-prefix "MODAPSProviderGateway")}
             :sync-activity-api {:type :aws
                                 :arn (str arn-prefix "MODAPSSync")}
             :conn_config {:type "http"}
             :num_connections 10
             :provider-id "MODAPS"}]
           (sys/get-gateway-providers sample-config)))))
