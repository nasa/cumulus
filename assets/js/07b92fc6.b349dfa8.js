"use strict";(self.webpackChunk_cumulus_website=self.webpackChunk_cumulus_website||[]).push([[58200],{15680:(e,t,a)=>{a.d(t,{xA:()=>s,yg:()=>y});var n=a(96540);function r(e,t,a){return t in e?Object.defineProperty(e,t,{value:a,enumerable:!0,configurable:!0,writable:!0}):e[t]=a,e}function l(e,t){var a=Object.keys(e);if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e);t&&(n=n.filter((function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable}))),a.push.apply(a,n)}return a}function i(e){for(var t=1;t<arguments.length;t++){var a=null!=arguments[t]?arguments[t]:{};t%2?l(Object(a),!0).forEach((function(t){r(e,t,a[t])})):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(a)):l(Object(a)).forEach((function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(a,t))}))}return e}function o(e,t){if(null==e)return{};var a,n,r=function(e,t){if(null==e)return{};var a,n,r={},l=Object.keys(e);for(n=0;n<l.length;n++)a=l[n],t.indexOf(a)>=0||(r[a]=e[a]);return r}(e,t);if(Object.getOwnPropertySymbols){var l=Object.getOwnPropertySymbols(e);for(n=0;n<l.length;n++)a=l[n],t.indexOf(a)>=0||Object.prototype.propertyIsEnumerable.call(e,a)&&(r[a]=e[a])}return r}var d=n.createContext({}),p=function(e){var t=n.useContext(d),a=t;return e&&(a="function"==typeof e?e(t):i(i({},t),e)),a},s=function(e){var t=p(e.components);return n.createElement(d.Provider,{value:t},e.children)},m="mdxType",u={inlineCode:"code",wrapper:function(e){var t=e.children;return n.createElement(n.Fragment,{},t)}},g=n.forwardRef((function(e,t){var a=e.components,r=e.mdxType,l=e.originalType,d=e.parentName,s=o(e,["components","mdxType","originalType","parentName"]),m=p(a),g=r,y=m["".concat(d,".").concat(g)]||m[g]||u[g]||l;return a?n.createElement(y,i(i({ref:t},s),{},{components:a})):n.createElement(y,i({ref:t},s))}));function y(e,t){var a=arguments,r=t&&t.mdxType;if("string"==typeof e||r){var l=a.length,i=new Array(l);i[0]=g;var o={};for(var d in t)hasOwnProperty.call(t,d)&&(o[d]=t[d]);o.originalType=e,o[m]="string"==typeof e?e:r,i[1]=o;for(var p=2;p<l;p++)i[p]=a[p];return n.createElement.apply(null,i)}return n.createElement.apply(null,a)}g.displayName="MDXCreateElement"},14815:(e,t,a)=>{a.r(t),a.d(t,{assets:()=>s,contentTitle:()=>d,default:()=>y,frontMatter:()=>o,metadata:()=>p,toc:()=>m});var n=a(58168),r=a(98587),l=(a(96540),a(15680)),i=["components"],o={id:"tracking-files",title:"Tracking Ancillary Files",hide_title:!1},d=void 0,p={unversionedId:"data-cookbooks/tracking-files",id:"version-v15.0.2/data-cookbooks/tracking-files",title:"Tracking Ancillary Files",description:"Contents",source:"@site/versioned_docs/version-v15.0.2/data-cookbooks/tracking-files.md",sourceDirName:"data-cookbooks",slug:"/data-cookbooks/tracking-files",permalink:"/cumulus/docs/v15.0.2/data-cookbooks/tracking-files",draft:!1,tags:[],version:"v15.0.2",lastUpdatedBy:"Naga Nages",lastUpdatedAt:1682721685,formattedLastUpdatedAt:"Apr 28, 2023",frontMatter:{id:"tracking-files",title:"Tracking Ancillary Files",hide_title:!1},sidebar:"Data Cookbooks",previous:{title:"Ingest Browse Generation",permalink:"/cumulus/docs/v15.0.2/data-cookbooks/browse-generation"},next:{title:"Run Step Function Tasks in AWS Lambda or Docker",permalink:"/cumulus/docs/v15.0.2/data-cookbooks/run-tasks-in-lambda-or-docker"}},s={},m=[{value:"Contents",id:"contents",level:2},{value:"Introduction",id:"introduction",level:3},{value:"File types",id:"file-types",level:3},{value:"File Type Configuration",id:"file-type-configuration",level:3},{value:"CMR Metadata",id:"cmr-metadata",level:3},{value:"Common Use Cases",id:"common-use-cases",level:3}],u={toc:m},g="wrapper";function y(e){var t=e.components,a=(0,r.A)(e,i);return(0,l.yg)(g,(0,n.A)({},u,a,{components:t,mdxType:"MDXLayout"}),(0,l.yg)("h2",{id:"contents"},"Contents"),(0,l.yg)("ul",null,(0,l.yg)("li",{parentName:"ul"},(0,l.yg)("a",{parentName:"li",href:"#contents"},"Contents"),(0,l.yg)("ul",{parentName:"li"},(0,l.yg)("li",{parentName:"ul"},(0,l.yg)("a",{parentName:"li",href:"#introduction"},"Introduction")),(0,l.yg)("li",{parentName:"ul"},(0,l.yg)("a",{parentName:"li",href:"#file-types"},"File types")),(0,l.yg)("li",{parentName:"ul"},(0,l.yg)("a",{parentName:"li",href:"#file-type-configuration"},"File Type Configuration")),(0,l.yg)("li",{parentName:"ul"},(0,l.yg)("a",{parentName:"li",href:"#cmr-metadata"},"CMR Metadata")),(0,l.yg)("li",{parentName:"ul"},(0,l.yg)("a",{parentName:"li",href:"#common-use-cases"},"Common Use Cases"))))),(0,l.yg)("h3",{id:"introduction"},"Introduction"),(0,l.yg)("p",null,"This document covers setting up ingest to track primary and ancillary files under various file types, which will carry through to the CMR and granule record.\nCumulus has a number of options for tracking files in granule records, and in CMR metadata under certain metadata elements or with specified file types.\nWe will cover Cumulus file types, file type configuration, effects on CMR metadata, and some common use case examples."),(0,l.yg)("h3",{id:"file-types"},"File types"),(0,l.yg)("p",null,"Cumulus follows the Cloud Notification Mechanism (CNM) file type conventions. Under this schema, there are four data types:"),(0,l.yg)("ul",null,(0,l.yg)("li",{parentName:"ul"},(0,l.yg)("inlineCode",{parentName:"li"},"data")),(0,l.yg)("li",{parentName:"ul"},(0,l.yg)("inlineCode",{parentName:"li"},"browse")),(0,l.yg)("li",{parentName:"ul"},(0,l.yg)("inlineCode",{parentName:"li"},"metadata")),(0,l.yg)("li",{parentName:"ul"},(0,l.yg)("inlineCode",{parentName:"li"},"qa"))),(0,l.yg)("p",null,"In Cumulus, these data types are mapped to the ",(0,l.yg)("inlineCode",{parentName:"p"},"Type")," attribute on ",(0,l.yg)("inlineCode",{parentName:"p"},"RelatedURL"),"s for UMM-G metadata, or used to map\nresources to one of ",(0,l.yg)("inlineCode",{parentName:"p"},"OnlineAccessURL"),", ",(0,l.yg)("inlineCode",{parentName:"p"},"OnlineResource")," or ",(0,l.yg)("inlineCode",{parentName:"p"},"AssociatedBrowseImages")," for ECHO10 XML metadata."),(0,l.yg)("h3",{id:"file-type-configuration"},"File Type Configuration"),(0,l.yg)("p",null,"File types for each file in a granule can be configured in a number of different ways, depending on the ingest type and workflow.\nFor more information, see the ",(0,l.yg)("a",{parentName:"p",href:"../features/ancillary_metadata"},"ancillary metadata")," documentation."),(0,l.yg)("h3",{id:"cmr-metadata"},"CMR Metadata"),(0,l.yg)("p",null,"When updating granule CMR metadata, the ",(0,l.yg)("inlineCode",{parentName:"p"},"UpdateGranulesCmrMetadataFileLinks")," task will add the external facing URLs to the CMR metadata file based on the file type.\nThe table below shows how the CNM data types map to CMR metadata updates. Non-CNM file types are handled as 'data' file types.\nThe UMM-G column reflects the ",(0,l.yg)("inlineCode",{parentName:"p"},"RelatedURL"),"'s ",(0,l.yg)("inlineCode",{parentName:"p"},"Type")," derived from the CNM type, whereas the ECHO10 column shows how the CNM type affects the destination element."),(0,l.yg)("table",null,(0,l.yg)("thead",{parentName:"table"},(0,l.yg)("tr",{parentName:"thead"},(0,l.yg)("th",{parentName:"tr",align:null},"CNM Type"),(0,l.yg)("th",{parentName:"tr",align:null},"UMM-G ",(0,l.yg)("inlineCode",{parentName:"th"},"RelatedUrl.Type")),(0,l.yg)("th",{parentName:"tr",align:null},"ECHO10 Location"))),(0,l.yg)("tbody",{parentName:"table"},(0,l.yg)("tr",{parentName:"tbody"},(0,l.yg)("td",{parentName:"tr",align:null},(0,l.yg)("inlineCode",{parentName:"td"},"ancillary")),(0,l.yg)("td",{parentName:"tr",align:null},(0,l.yg)("inlineCode",{parentName:"td"},"'VIEW RELATED INFORMATION'")),(0,l.yg)("td",{parentName:"tr",align:null},(0,l.yg)("inlineCode",{parentName:"td"},"OnlineResource"))),(0,l.yg)("tr",{parentName:"tbody"},(0,l.yg)("td",{parentName:"tr",align:null},(0,l.yg)("inlineCode",{parentName:"td"},"data")),(0,l.yg)("td",{parentName:"tr",align:null},(0,l.yg)("inlineCode",{parentName:"td"},"'GET DATA'"),"(HTTPS URL) or ",(0,l.yg)("inlineCode",{parentName:"td"},"'GET DATA VIA DIRECT ACCESS'"),"(S3 URI)"),(0,l.yg)("td",{parentName:"tr",align:null},(0,l.yg)("inlineCode",{parentName:"td"},"OnlineAccessURL"))),(0,l.yg)("tr",{parentName:"tbody"},(0,l.yg)("td",{parentName:"tr",align:null},(0,l.yg)("inlineCode",{parentName:"td"},"browse")),(0,l.yg)("td",{parentName:"tr",align:null},(0,l.yg)("inlineCode",{parentName:"td"},"'GET RELATED VISUALIZATION'")),(0,l.yg)("td",{parentName:"tr",align:null},(0,l.yg)("inlineCode",{parentName:"td"},"AssociatedBrowseImage"))),(0,l.yg)("tr",{parentName:"tbody"},(0,l.yg)("td",{parentName:"tr",align:null},(0,l.yg)("inlineCode",{parentName:"td"},"linkage")),(0,l.yg)("td",{parentName:"tr",align:null},(0,l.yg)("inlineCode",{parentName:"td"},"'EXTENDED METADATA'")),(0,l.yg)("td",{parentName:"tr",align:null},(0,l.yg)("inlineCode",{parentName:"td"},"OnlineResource"))),(0,l.yg)("tr",{parentName:"tbody"},(0,l.yg)("td",{parentName:"tr",align:null},(0,l.yg)("inlineCode",{parentName:"td"},"metadata")),(0,l.yg)("td",{parentName:"tr",align:null},(0,l.yg)("inlineCode",{parentName:"td"},"'EXTENDED METADATA'")),(0,l.yg)("td",{parentName:"tr",align:null},(0,l.yg)("inlineCode",{parentName:"td"},"OnlineResource"))),(0,l.yg)("tr",{parentName:"tbody"},(0,l.yg)("td",{parentName:"tr",align:null},(0,l.yg)("inlineCode",{parentName:"td"},"qa")),(0,l.yg)("td",{parentName:"tr",align:null},(0,l.yg)("inlineCode",{parentName:"td"},"'EXTENDED METADATA'")),(0,l.yg)("td",{parentName:"tr",align:null},(0,l.yg)("inlineCode",{parentName:"td"},"OnlineResource"))))),(0,l.yg)("h3",{id:"common-use-cases"},"Common Use Cases"),(0,l.yg)("p",null,"This section briefly documents some common use cases and the recommended configuration for the file.\nThe examples shown here are for the DiscoverGranules use case, which allows configuration at the Cumulus dashboard level.\nThe other two cases covered in the ",(0,l.yg)("a",{parentName:"p",href:"../features/ancillary_metadata"},"ancillary metadata")," documentation require configuration at the provider notification level (either CNM message or PDR) and are not covered here."),(0,l.yg)("p",null,"Configuring browse imagery:"),(0,l.yg)("pre",null,(0,l.yg)("code",{parentName:"pre",className:"language-json"},'{\n  "bucket": "public",\n  "regex": "^MOD09GQ\\\\.A[\\\\d]{7}\\\\.[\\\\S]{6}\\\\.006\\\\.[\\\\d]{13}\\\\_[\\\\d]{1}.jpg$",\n  "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104_1.jpg",\n  "type": "browse"\n}\n')),(0,l.yg)("p",null,"Configuring a documentation entry:"),(0,l.yg)("pre",null,(0,l.yg)("code",{parentName:"pre",className:"language-json"},'{\n  "bucket": "protected",\n  "regex": "^MOD09GQ\\\\.A[\\\\d]{7}\\\\.[\\\\S]{6}\\\\.006\\\\.[\\\\d]{13}\\\\_README.pdf$",\n  "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104_README.pdf",\n  "type": "metadata"\n}\n')),(0,l.yg)("p",null,"Configuring other associated files (use types ",(0,l.yg)("inlineCode",{parentName:"p"},"metadata")," or ",(0,l.yg)("inlineCode",{parentName:"p"},"qa")," as appropriate):"),(0,l.yg)("pre",null,(0,l.yg)("code",{parentName:"pre",className:"language-json"},'{\n  "bucket": "protected",\n  "regex": "^MOD09GQ\\\\.A[\\\\d]{7}\\\\.[\\\\S]{6}\\\\.006\\\\.[\\\\d]{13}\\\\_QA.txt$",\n  "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104_QA.txt",\n  "type": "qa"\n}\n')))}y.isMDXComponent=!0}}]);