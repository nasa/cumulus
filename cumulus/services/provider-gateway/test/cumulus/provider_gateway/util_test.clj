(ns cumulus.provider-gateway.util-test
  (:require
   [clojure.test :refer :all]
   [cumulus.provider-gateway.util :as u]))

(def lookup-data
  {:meta {:epsg_thing 44 :collection-id "foo" :date {:year 2017}}})

(def lots-special-chars
  "abc123!@#$%^&*()_+~`-=[]{});':\"\",./<>?\\|\t ")

(deftest mustache-replace-test
  (are [string expected]
    (= expected (u/mustache-replace lookup-data string))
    ;; non replacements
    "{" "{"
    "{}" "{}"
    "{a" "{a"
    "a}" "a}"
    "}" "}"
    "{ald/dafd}" "{ald/dafd}"

    ;; not found
    "123{a}456" "123456"

    ;; replacement examples
    "{meta.collection-id}" "foo"

    ;; lots of characters
    (str lots-special-chars "{meta.collection-id}" lots-special-chars)
    (str lots-special-chars "foo" lots-special-chars)

    ;; multiple duplicates
    "{meta.collection-id} {meta.collection-id} {meta.collection-id}" "foo foo foo"
    "{meta.collection-id} {meta.date.year} {meta.collection-id}" "foo 2017 foo"

    "some{meta.epsg_thing}/{meta.collection-id}/{meta.date.year}end"
    "some44/foo/2017end"))

(deftest populate-message-config-replacements
  (is (= {:foo [{:bar "foo"}
                {:charlie "The year is 2017"}]
          :alpha "44"}
         (u/populate-message-config-replacements
          lookup-data
          {:foo [{:bar "{meta.collection-id}"}
                 {:charlie "The year is {meta.date.year}"}]
           :alpha "{meta.epsg_thing}"}))))

