"use strict";(self.webpackChunk_cumulus_website=self.webpackChunk_cumulus_website||[]).push([[78617],{15680:(e,n,t)=>{t.d(n,{xA:()=>l,yg:()=>g});var i=t(96540);function a(e,n,t){return n in e?Object.defineProperty(e,n,{value:t,enumerable:!0,configurable:!0,writable:!0}):e[n]=t,e}function o(e,n){var t=Object.keys(e);if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(e);n&&(i=i.filter((function(n){return Object.getOwnPropertyDescriptor(e,n).enumerable}))),t.push.apply(t,i)}return t}function r(e){for(var n=1;n<arguments.length;n++){var t=null!=arguments[n]?arguments[n]:{};n%2?o(Object(t),!0).forEach((function(n){a(e,n,t[n])})):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(t)):o(Object(t)).forEach((function(n){Object.defineProperty(e,n,Object.getOwnPropertyDescriptor(t,n))}))}return e}function d(e,n){if(null==e)return{};var t,i,a=function(e,n){if(null==e)return{};var t,i,a={},o=Object.keys(e);for(i=0;i<o.length;i++)t=o[i],n.indexOf(t)>=0||(a[t]=e[t]);return a}(e,n);if(Object.getOwnPropertySymbols){var o=Object.getOwnPropertySymbols(e);for(i=0;i<o.length;i++)t=o[i],n.indexOf(t)>=0||Object.prototype.propertyIsEnumerable.call(e,t)&&(a[t]=e[t])}return a}var s=i.createContext({}),u=function(e){var n=i.useContext(s),t=n;return e&&(t="function"==typeof e?e(n):r(r({},n),e)),t},l=function(e){var n=u(e.components);return i.createElement(s.Provider,{value:n},e.children)},c="mdxType",h={inlineCode:"code",wrapper:function(e){var n=e.children;return i.createElement(i.Fragment,{},n)}},p=i.forwardRef((function(e,n){var t=e.components,a=e.mdxType,o=e.originalType,s=e.parentName,l=d(e,["components","mdxType","originalType","parentName"]),c=u(t),p=a,g=c["".concat(s,".").concat(p)]||c[p]||h[p]||o;return t?i.createElement(g,r(r({ref:n},l),{},{components:t})):i.createElement(g,r({ref:n},l))}));function g(e,n){var t=arguments,a=n&&n.mdxType;if("string"==typeof e||a){var o=t.length,r=new Array(o);r[0]=p;var d={};for(var s in n)hasOwnProperty.call(n,s)&&(d[s]=n[s]);d.originalType=e,d[c]="string"==typeof e?e:a,r[1]=d;for(var u=2;u<o;u++)r[u]=t[u];return i.createElement.apply(null,r)}return i.createElement.apply(null,t)}p.displayName="MDXCreateElement"},71936:(e,n,t)=>{t.r(n),t.d(n,{assets:()=>l,contentTitle:()=>s,default:()=>g,frontMatter:()=>d,metadata:()=>u,toc:()=>c});var i=t(58168),a=t(98587),o=(t(96540),t(15680)),r=["components"],d={id:"reindex-elasticsearch",title:"Reindexing Elasticsearch Guide",hide_title:!1},s=void 0,u={unversionedId:"troubleshooting/reindex-elasticsearch",id:"version-v13.4.0/troubleshooting/reindex-elasticsearch",title:"Reindexing Elasticsearch Guide",description:"You may find yourself in a situation where you need to reindex your Elasticsearch index if you have issues with your",source:"@site/versioned_docs/version-v13.4.0/troubleshooting/reindex-elasticsearch.md",sourceDirName:"troubleshooting",slug:"/troubleshooting/reindex-elasticsearch",permalink:"/cumulus/docs/v13.4.0/troubleshooting/reindex-elasticsearch",draft:!1,tags:[],version:"v13.4.0",lastUpdatedBy:"jennyhliu",lastUpdatedAt:1678406688,formattedLastUpdatedAt:"Mar 10, 2023",frontMatter:{id:"reindex-elasticsearch",title:"Reindexing Elasticsearch Guide",hide_title:!1},sidebar:"docs",previous:{title:"Troubleshooting Deployment",permalink:"/cumulus/docs/v13.4.0/troubleshooting/troubleshooting-deployment"},next:{title:"Contributing a Task",permalink:"/cumulus/docs/v13.4.0/adding-a-task"}},l={},c=[{value:"Switch to a new index and Reindex",id:"switch-to-a-new-index-and-reindex",level:2},{value:"Change Index",id:"change-index",level:3},{value:"Reindex from the old index to the new index",id:"reindex-from-the-old-index-to-the-new-index",level:3},{value:"Reindex status",id:"reindex-status",level:4},{value:"Index from database",id:"index-from-database",level:2},{value:"Validate reindex",id:"validate-reindex",level:2},{value:"Resuming a reindex",id:"resuming-a-reindex",level:2}],h={toc:c},p="wrapper";function g(e){var n=e.components,t=(0,a.A)(e,r);return(0,o.yg)(p,(0,i.A)({},h,t,{components:n,mdxType:"MDXLayout"}),(0,o.yg)("p",null,"You may find yourself in a situation where you need to reindex your Elasticsearch index if you have issues with your\ncurrent index, or the mappings for an index have been updated (they do not update automatically). Any reindexing that will be required when upgrading Cumulus will be in the Migration Steps section of the changelog."),(0,o.yg)("h2",{id:"switch-to-a-new-index-and-reindex"},"Switch to a new index and Reindex"),(0,o.yg)("p",null,"There are two operations needed: ",(0,o.yg)("a",{parentName:"p",href:"https://nasa.github.io/cumulus-api/#reindex"},"reindex")," and ",(0,o.yg)("a",{parentName:"p",href:"https://nasa.github.io/cumulus-api/#change-index"},"change-index")," to switch over to the new index. A Change Index/Reindex can be done in either order, but both have their trade-offs."),(0,o.yg)("p",null,"If you decide to point Cumulus to a new (empty) index first (with a change index operation), and then Reindex the data to the new index, data ingested while reindexing will automatically be sent to the new index. As reindexing operations can take a while, not all the data will show up on the Cumulus Dashboard right away. The advantage is you do not have to turn of any ingest operations. This way is recommended."),(0,o.yg)("p",null,"If you decide to Reindex data to a new index first, and then point Cumulus to that new index, it is not guaranteed that data that is sent to the old index while reindexing will show up in the new index. If you prefer this way, it is recommended to turn off any ingest operations. This order will keep your dashboard data from seeing any interruption."),(0,o.yg)("h3",{id:"change-index"},"Change Index"),(0,o.yg)("p",null,"This will point Cumulus to the index in Elasticsearch that will be used when retrieving data. Performing a change index operation to an index that does not exist yet will create the index for you. The change index operation can be found ",(0,o.yg)("a",{parentName:"p",href:"https://nasa.github.io/cumulus-api/#change-index"},"here"),"."),(0,o.yg)("h3",{id:"reindex-from-the-old-index-to-the-new-index"},"Reindex from the old index to the new index"),(0,o.yg)("p",null,"The reindex operation will take the data from one index and copy it into another index. The reindex operation can be found ",(0,o.yg)("a",{parentName:"p",href:"https://nasa.github.io/cumulus-api/#reindex"},"here")),(0,o.yg)("h4",{id:"reindex-status"},"Reindex status"),(0,o.yg)("p",null,"Reindexing is a long-running operation. The ",(0,o.yg)("a",{parentName:"p",href:"https://nasa.github.io/cumulus-api/#reindex-status"},"reindex-status")," endpoint can be used to monitor the progress of the operation."),(0,o.yg)("h2",{id:"index-from-database"},"Index from database"),(0,o.yg)("p",null,"If you want to just grab the data straight from the database you can perform an ",(0,o.yg)("a",{parentName:"p",href:"https://nasa.github.io/cumulus-api/#index-from-database"},"Index from Database Operation"),". After the data is indexed from the database, a  ",(0,o.yg)("a",{parentName:"p",href:"https://nasa.github.io/cumulus-api/#change-index"},"Change Index operation")," will need\nto be performed to ensure Cumulus is pointing to the right index. It is ",(0,o.yg)("strong",{parentName:"p"},"strongly recommended")," to turn off\nworkflow rules when performing this operation so any data ingested to the database is not lost."),(0,o.yg)("h2",{id:"validate-reindex"},"Validate reindex"),(0,o.yg)("p",null,"To validate the reindex, use the ",(0,o.yg)("a",{parentName:"p",href:"https://nasa.github.io/cumulus-api/#reindex-status"},"reindex-status")," endpoint. The doc count can be used to verify that the reindex was successful. In the below example the reindex from ",(0,o.yg)("inlineCode",{parentName:"p"},"cumulus-2020-11-3")," to ",(0,o.yg)("inlineCode",{parentName:"p"},"cumulus-2021-3-4")," was not fully successful as they show different doc counts."),(0,o.yg)("pre",null,(0,o.yg)("code",{parentName:"pre",className:"language-json"},'"indices": {\n  "cumulus-2020-11-3": {\n    "primaries": {\n      "docs": {\n        "count": 21096512,\n        "deleted": 176895\n      }\n    },\n    "total": {\n      "docs": {\n        "count": 21096512,\n        "deleted": 176895\n      }\n    }\n  },\n  "cumulus-2021-3-4": {\n    "primaries": {\n      "docs": {\n        "count": 715949,\n        "deleted": 140191\n      }\n    },\n    "total": {\n      "docs": {\n        "count": 715949,\n        "deleted": 140191\n      }\n    }\n  }\n}\n')),(0,o.yg)("p",null,"To further drill down into what is missing, log in to the Kibana instance (found in the Elasticsearch section of the AWS console) and run the following command replacing ",(0,o.yg)("inlineCode",{parentName:"p"},"<index>")," with your index name."),(0,o.yg)("pre",null,(0,o.yg)("code",{parentName:"pre",className:"language-json"},'GET <index>/_search\n{\n  "aggs": {\n        "count_by_type": {\n            "terms": {\n                "field": "_type"\n            }\n        }\n    },\n    "size": 0\n}\n')),(0,o.yg)("p",null,"which will produce a result like"),(0,o.yg)("pre",null,(0,o.yg)("code",{parentName:"pre",className:"language-json"},'"aggregations": {\n  "count_by_type": {\n    "doc_count_error_upper_bound": 0,\n    "sum_other_doc_count": 0,\n    "buckets": [\n      {\n        "key": "logs",\n        "doc_count": 483955\n      },\n      {\n        "key": "execution",\n        "doc_count": 4966\n      },\n      {\n        "key": "deletedgranule",\n        "doc_count": 4715\n      },\n      {\n        "key": "pdr",\n        "doc_count": 1822\n      },\n      {\n        "key": "granule",\n        "doc_count": 740\n      },\n      {\n        "key": "asyncOperation",\n        "doc_count": 616\n      },\n      {\n        "key": "provider",\n        "doc_count": 108\n      },\n      {\n        "key": "collection",\n        "doc_count": 87\n      },\n      {\n        "key": "reconciliationReport",\n        "doc_count": 48\n      },\n      {\n        "key": "rule",\n        "doc_count": 7\n      }\n    ]\n  }\n}\n')),(0,o.yg)("h2",{id:"resuming-a-reindex"},"Resuming a reindex"),(0,o.yg)("p",null,"If a reindex operation did not fully complete it can be resumed using the following command run from the Kibana instance."),(0,o.yg)("pre",null,(0,o.yg)("code",{parentName:"pre",className:"language-json"},'POST _reindex?wait_for_completion=false\n{\n"conflicts": "proceed",\n  "source": {\n    "index": "cumulus-2020-11-3"\n  },\n  "dest": {\n    "index": "cumulus-2021-3-4",\n    "op_type": "create"\n  }\n}\n')),(0,o.yg)("p",null,"The Cumulus API ",(0,o.yg)("a",{parentName:"p",href:"https://nasa.github.io/cumulus-api/#reindex-status"},"reindex-status")," endpoint can be used to monitor completion of this operation."))}g.isMDXComponent=!0}}]);