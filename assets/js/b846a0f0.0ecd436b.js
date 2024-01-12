"use strict";(self.webpackChunk_cumulus_website=self.webpackChunk_cumulus_website||[]).push([[35979],{3905:(e,t,r)=>{r.d(t,{Zo:()=>d,kt:()=>f});var n=r(67294);function i(e,t,r){return t in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e}function o(e,t){var r=Object.keys(e);if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e);t&&(n=n.filter((function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable}))),r.push.apply(r,n)}return r}function a(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{};t%2?o(Object(r),!0).forEach((function(t){i(e,t,r[t])})):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):o(Object(r)).forEach((function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))}))}return e}function l(e,t){if(null==e)return{};var r,n,i=function(e,t){if(null==e)return{};var r,n,i={},o=Object.keys(e);for(n=0;n<o.length;n++)r=o[n],t.indexOf(r)>=0||(i[r]=e[r]);return i}(e,t);if(Object.getOwnPropertySymbols){var o=Object.getOwnPropertySymbols(e);for(n=0;n<o.length;n++)r=o[n],t.indexOf(r)>=0||Object.prototype.propertyIsEnumerable.call(e,r)&&(i[r]=e[r])}return i}var s=n.createContext({}),p=function(e){var t=n.useContext(s),r=t;return e&&(r="function"==typeof e?e(t):a(a({},t),e)),r},d=function(e){var t=p(e.components);return n.createElement(s.Provider,{value:t},e.children)},u="mdxType",c={inlineCode:"code",wrapper:function(e){var t=e.children;return n.createElement(n.Fragment,{},t)}},m=n.forwardRef((function(e,t){var r=e.components,i=e.mdxType,o=e.originalType,s=e.parentName,d=l(e,["components","mdxType","originalType","parentName"]),u=p(r),m=i,f=u["".concat(s,".").concat(m)]||u[m]||c[m]||o;return r?n.createElement(f,a(a({ref:t},d),{},{components:r})):n.createElement(f,a({ref:t},d))}));function f(e,t){var r=arguments,i=t&&t.mdxType;if("string"==typeof e||i){var o=r.length,a=new Array(o);a[0]=m;var l={};for(var s in t)hasOwnProperty.call(t,s)&&(l[s]=t[s]);l.originalType=e,l[u]="string"==typeof e?e:i,a[1]=l;for(var p=2;p<o;p++)a[p]=r[p];return n.createElement.apply(null,a)}return n.createElement.apply(null,r)}m.displayName="MDXCreateElement"},13420:(e,t,r)=>{r.r(t),r.d(t,{assets:()=>d,contentTitle:()=>s,default:()=>f,frontMatter:()=>l,metadata:()=>p,toc:()=>u});var n=r(87462),i=r(63366),o=(r(67294),r(3905)),a=["components"],l={id:"discovery-filtering",title:"Discovery Filtering",hide_title:!1},s=void 0,p={unversionedId:"operator-docs/discovery-filtering",id:"version-v16.1.2/operator-docs/discovery-filtering",title:"Discovery Filtering",description:"Discovery filtering is an advanced feature of the discover-granules and discover-pdrs tasks.",source:"@site/versioned_docs/version-v16.1.2/operator-docs/discovery-filtering.md",sourceDirName:"operator-docs",slug:"/operator-docs/discovery-filtering",permalink:"/cumulus/docs/v16.1.2/operator-docs/discovery-filtering",draft:!1,tags:[],version:"v16.1.2",lastUpdatedBy:"jennyhliu",lastUpdatedAt:1698871291,formattedLastUpdatedAt:"Nov 1, 2023",frontMatter:{id:"discovery-filtering",title:"Discovery Filtering",hide_title:!1},sidebar:"docs",previous:{title:"Operations",permalink:"/cumulus/docs/v16.1.2/category/operations"},next:{title:"Bulk Operations",permalink:"/cumulus/docs/v16.1.2/operator-docs/bulk-operations"}},d={},u=[{value:"Using discovery filtering",id:"using-discovery-filtering",level:2},{value:"Troubleshooting",id:"troubleshooting",level:2},{value:"Supported protocols",id:"supported-protocols",level:2}],c={toc:u},m="wrapper";function f(e){var t=e.components,r=(0,i.Z)(e,a);return(0,o.kt)(m,(0,n.Z)({},c,r,{components:t,mdxType:"MDXLayout"}),(0,o.kt)("p",null,"Discovery filtering is an advanced feature of the ",(0,o.kt)("inlineCode",{parentName:"p"},"discover-granules")," and ",(0,o.kt)("inlineCode",{parentName:"p"},"discover-pdrs")," tasks.\nIt is a configurable option for discovery that allows an operator to manipulate which parts of a\nremote file system Cumulus will attempt discovery in."),(0,o.kt)("p",null,"This is useful when operators want to limit run time or network load when attempting discovery on a\nvery large remote file system for a small subset of files."),(0,o.kt)("h2",{id:"using-discovery-filtering"},"Using discovery filtering"),(0,o.kt)("p",null,"This feature is available for certain ingest protocols (see below), and allows operators\nto filter which paths on a remote file system are explored by interpreting each segment of the\ntask's ",(0,o.kt)("inlineCode",{parentName:"p"},"config.provider_path")," as a regular expression to filter contents listed recursively,\nstarting from the default directory."),(0,o.kt)("p",null,"Items that fail the filter are ignored.\nAn item that passes the filter is handled depending on its type:"),(0,o.kt)("ul",null,(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("em",{parentName:"li"},"Directories")," that pass the filter are ",(0,o.kt)("strong",{parentName:"li"},"recurred into")," for further recursive listing."),(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("em",{parentName:"li"},"Files")," that pass the filter are ",(0,o.kt)("strong",{parentName:"li"},"appended")," to the final output returned by the discovery.")),(0,o.kt)("p",null,"Two example values for ",(0,o.kt)("inlineCode",{parentName:"p"},"provider_path")," are provided below to help explain the recursive filtering algorithm:"),(0,o.kt)("pre",null,(0,o.kt)("code",{parentName:"pre",className:"language-json"},'{\n  "provider_path": "(MOD0.*)/PDR/"\n}\n')),(0,o.kt)("p",null,"The path shown above will:"),(0,o.kt)("ul",null,(0,o.kt)("li",{parentName:"ul"},"list contents of the default directory,"),(0,o.kt)("li",{parentName:"ul"},"append or recur into any item matching ",(0,o.kt)("inlineCode",{parentName:"li"},"MOD0.*"),", e.g. ",(0,o.kt)("inlineCode",{parentName:"li"},"MOD09GQ"),","),(0,o.kt)("li",{parentName:"ul"},"append or recur into any item in directories from the previous step named ",(0,o.kt)("inlineCode",{parentName:"li"},"PDR"),","),(0,o.kt)("li",{parentName:"ul"},"append and recur into everything in ",(0,o.kt)("inlineCode",{parentName:"li"},"PDR")," without filtering anything out.")),(0,o.kt)("pre",null,(0,o.kt)("code",{parentName:"pre",className:"language-json"},'{\n  "provider_path": "daily/(199.)/data/(.*.nc)"\n}\n')),(0,o.kt)("p",null,"The path shown above will:"),(0,o.kt)("ul",null,(0,o.kt)("li",{parentName:"ul"},"list contents of the default directory,"),(0,o.kt)("li",{parentName:"ul"},"append or recur into any item named ",(0,o.kt)("inlineCode",{parentName:"li"},"daily"),","),(0,o.kt)("li",{parentName:"ul"},"append or recur into any item in ",(0,o.kt)("inlineCode",{parentName:"li"},"daily")," that matches ",(0,o.kt)("inlineCode",{parentName:"li"},"199."),", e.g. '1997',"),(0,o.kt)("li",{parentName:"ul"},"append or recur into any item in directories from the previous step named ",(0,o.kt)("inlineCode",{parentName:"li"},"data"),","),(0,o.kt)("li",{parentName:"ul"},"append or recur into all items that end in ",(0,o.kt)("inlineCode",{parentName:"li"},".nc"),","),(0,o.kt)("li",{parentName:"ul"},"append or recur into everything in any directories that ended in ",(0,o.kt)("inlineCode",{parentName:"li"},".nc")," without filtering anything out.")),(0,o.kt)("admonition",{type:"note"},(0,o.kt)("p",{parentName:"admonition"},"Each discovery task performs its own post-discovery filtering on some relevant\nvalue, e.g. ",(0,o.kt)("inlineCode",{parentName:"p"},"granuleIdExtraction")," for discover-granules, so discovery filtering is intended to\nbe used primarily to limit unnecessary exploration of large file systems, ",(0,o.kt)("em",{parentName:"p"},"not")," to filter for\nspecific files.")),(0,o.kt)("h2",{id:"troubleshooting"},"Troubleshooting"),(0,o.kt)("p",null,"An error during recursive filtering causes the algorithm to back out and default to attempting to\ndirectly list the ",(0,o.kt)("inlineCode",{parentName:"p"},"provider_path"),". If the path contains regular expression components, this may fail."),(0,o.kt)("p",null,"It is recommended that operators diagnose any failures by checking error logs and ensuring that\npermissions on the remote file system allow reading of the default directory and any subdirectories\nthat match the filter."),(0,o.kt)("h2",{id:"supported-protocols"},"Supported protocols"),(0,o.kt)("p",null,"Currently support for this feature is limited to the following protocols:"),(0,o.kt)("ul",null,(0,o.kt)("li",{parentName:"ul"},"ftp"),(0,o.kt)("li",{parentName:"ul"},"sftp")))}f.isMDXComponent=!0}}]);