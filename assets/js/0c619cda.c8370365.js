"use strict";(self.webpackChunk_cumulus_website=self.webpackChunk_cumulus_website||[]).push([[96163],{3905:(e,t,n)=>{n.d(t,{Zo:()=>u,kt:()=>h});var a=n(67294);function i(e,t,n){return t in e?Object.defineProperty(e,t,{value:n,enumerable:!0,configurable:!0,writable:!0}):e[t]=n,e}function o(e,t){var n=Object.keys(e);if(Object.getOwnPropertySymbols){var a=Object.getOwnPropertySymbols(e);t&&(a=a.filter((function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable}))),n.push.apply(n,a)}return n}function r(e){for(var t=1;t<arguments.length;t++){var n=null!=arguments[t]?arguments[t]:{};t%2?o(Object(n),!0).forEach((function(t){i(e,t,n[t])})):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(n)):o(Object(n)).forEach((function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(n,t))}))}return e}function s(e,t){if(null==e)return{};var n,a,i=function(e,t){if(null==e)return{};var n,a,i={},o=Object.keys(e);for(a=0;a<o.length;a++)n=o[a],t.indexOf(n)>=0||(i[n]=e[n]);return i}(e,t);if(Object.getOwnPropertySymbols){var o=Object.getOwnPropertySymbols(e);for(a=0;a<o.length;a++)n=o[a],t.indexOf(n)>=0||Object.prototype.propertyIsEnumerable.call(e,n)&&(i[n]=e[n])}return i}var d=a.createContext({}),l=function(e){var t=a.useContext(d),n=t;return e&&(n="function"==typeof e?e(t):r(r({},t),e)),n},u=function(e){var t=l(e.components);return a.createElement(d.Provider,{value:t},e.children)},c="mdxType",p={inlineCode:"code",wrapper:function(e){var t=e.children;return a.createElement(a.Fragment,{},t)}},m=a.forwardRef((function(e,t){var n=e.components,i=e.mdxType,o=e.originalType,d=e.parentName,u=s(e,["components","mdxType","originalType","parentName"]),c=l(n),m=i,h=c["".concat(d,".").concat(m)]||c[m]||p[m]||o;return n?a.createElement(h,r(r({ref:t},u),{},{components:n})):a.createElement(h,r({ref:t},u))}));function h(e,t){var n=arguments,i=t&&t.mdxType;if("string"==typeof e||i){var o=n.length,r=new Array(o);r[0]=m;var s={};for(var d in t)hasOwnProperty.call(t,d)&&(s[d]=t[d]);s.originalType=e,s[c]="string"==typeof e?e:i,r[1]=s;for(var l=2;l<o;l++)r[l]=n[l];return a.createElement.apply(null,r)}return a.createElement.apply(null,n)}m.displayName="MDXCreateElement"},60324:(e,t,n)=>{n.r(t),n.d(t,{assets:()=>u,contentTitle:()=>d,default:()=>h,frontMatter:()=>s,metadata:()=>l,toc:()=>c});var a=n(87462),i=n(63366),o=(n(67294),n(3905)),r=["components"],s={id:"docs-how-to",title:"Cumulus Documentation: How To's",hide_title:!1},d=void 0,l={unversionedId:"docs-how-to",id:"version-v16.1.1/docs-how-to",title:"Cumulus Documentation: How To's",description:"Cumulus Docs Installation",source:"@site/versioned_docs/version-v16.1.1/docs-how-to.md",sourceDirName:".",slug:"/docs-how-to",permalink:"/cumulus/docs/v16.1.1/docs-how-to",draft:!1,tags:[],version:"v16.1.1",lastUpdatedBy:"Nate Pauzenga",lastUpdatedAt:1691507415,formattedLastUpdatedAt:"Aug 8, 2023",frontMatter:{id:"docs-how-to",title:"Cumulus Documentation: How To's",hide_title:!1},sidebar:"docs",previous:{title:"Contributing a Task",permalink:"/cumulus/docs/v16.1.1/adding-a-task"},next:{title:"Integrator Guide",permalink:"/cumulus/docs/v16.1.1/category/integrator-guide"}},u={},c=[{value:"Cumulus Docs Installation",id:"cumulus-docs-installation",level:2},{value:"Run a Local Server",id:"run-a-local-server",level:3},{value:"Cumulus Documentation",id:"cumulus-documentation",level:3},{value:"Add a New Page and Sidebars",id:"add-a-new-page-and-sidebars",level:4},{value:"Versioning Docs",id:"versioning-docs",level:4},{value:"Search",id:"search",level:4},{value:"Add a new task",id:"add-a-new-task",level:4},{value:"Editing the tasks.md header or template",id:"editing-the-tasksmd-header-or-template",level:4},{value:"Editing diagrams",id:"editing-diagrams",level:4},{value:"Deployment",id:"deployment",level:3}],p={toc:c},m="wrapper";function h(e){var t=e.components,n=(0,i.Z)(e,r);return(0,o.kt)(m,(0,a.Z)({},p,n,{components:t,mdxType:"MDXLayout"}),(0,o.kt)("h2",{id:"cumulus-docs-installation"},"Cumulus Docs Installation"),(0,o.kt)("h3",{id:"run-a-local-server"},"Run a Local Server"),(0,o.kt)("p",null,"Environment variables ",(0,o.kt)("inlineCode",{parentName:"p"},"DOCSEARCH_APP_ID"),", ",(0,o.kt)("inlineCode",{parentName:"p"},"DOCSEARCH_API_KEY")," and ",(0,o.kt)("inlineCode",{parentName:"p"},"DOCSEARCH_INDEX_NAME")," must be set for search to work. At the moment, search is only truly functional on prod because that is the only website we have registered to be indexed with DocSearch (see below on search)."),(0,o.kt)("pre",null,(0,o.kt)("code",{parentName:"pre",className:"language-sh"},"git clone git@github.com:nasa/cumulus\ncd cumulus\nnpm run docs-install\nnpm run docs-serve\n")),(0,o.kt)("admonition",{type:"note"},(0,o.kt)("p",{parentName:"admonition"},(0,o.kt)("inlineCode",{parentName:"p"},"docs-build")," will build the documents into ",(0,o.kt)("inlineCode",{parentName:"p"},"website/build"),".\n",(0,o.kt)("inlineCode",{parentName:"p"},"docs-clear")," will clear the documents.")),(0,o.kt)("admonition",{type:"caution"},(0,o.kt)("p",{parentName:"admonition"},"Fix any broken links reported by Docusaurus if you see the following messages during build."),(0,o.kt)("p",{parentName:"admonition"},"[INFO]"," Docusaurus found broken links!"),(0,o.kt)("p",{parentName:"admonition"},"Exhaustive list of all broken links found:")),(0,o.kt)("h3",{id:"cumulus-documentation"},"Cumulus Documentation"),(0,o.kt)("p",null,"Our project documentation is hosted on ",(0,o.kt)("a",{parentName:"p",href:"https://pages.github.com/"},"GitHub Pages"),". The resources published to this website are housed in ",(0,o.kt)("inlineCode",{parentName:"p"},"docs/")," directory at the top of the Cumulus repository. Those resources primarily consist of markdown files and images."),(0,o.kt)("p",null,"We use the open-source static website generator ",(0,o.kt)("a",{parentName:"p",href:"https://docusaurus.io/docs"},"Docusaurus")," to build html files from our markdown documentation, add some organization and navigation, and provide some other niceties in the final website (search, easy templating, etc.)."),(0,o.kt)("h4",{id:"add-a-new-page-and-sidebars"},"Add a New Page and Sidebars"),(0,o.kt)("p",null,"Adding a new page should be as simple as writing some documentation in markdown, placing it under the correct directory in the ",(0,o.kt)("inlineCode",{parentName:"p"},"docs/")," folder and adding some configuration values wrapped by ",(0,o.kt)("inlineCode",{parentName:"p"},"---")," at the top of the file. There are many files that already have this header which can be used as reference."),(0,o.kt)("pre",null,(0,o.kt)("code",{parentName:"pre",className:"language-markdown"},"---\nid: doc-unique-id    # unique id for this document. This must be unique across ALL documentation under docs/\ntitle: Title Of Doc  # Whatever title you feel like adding. This will show up as the index to this page on the sidebar.\nhide_title: false\n---\n")),(0,o.kt)("admonition",{type:"note"},(0,o.kt)("p",{parentName:"admonition"},"To have the new page show up in a sidebar the designated ",(0,o.kt)("inlineCode",{parentName:"p"},"id")," must be added to a sidebar in the ",(0,o.kt)("inlineCode",{parentName:"p"},"website/sidebars.js")," file. Docusaurus has an in depth explanation of sidebars ",(0,o.kt)("a",{parentName:"p",href:"https://docusaurus.io/docs/en/navigation"},"here"),".")),(0,o.kt)("h4",{id:"versioning-docs"},"Versioning Docs"),(0,o.kt)("p",null,"We lean heavily on Docusaurus for versioning. Their suggestions and walk-through can be found ",(0,o.kt)("a",{parentName:"p",href:"https://docusaurus.io/docs/versioning"},"here"),". Docusaurus v2 uses snapshot approach for documentation versioning. Every versioned docs does not depends on other version.\nIt is worth noting that we would like the Documentation versions to match up directly with release versions. However, a new versioned docs can take up a lot of repo space and require maintenance, we suggest to update existing versioned docs for minor releases when there are no significant functionality changes.  Cumulus versioning is explained in the ",(0,o.kt)("a",{parentName:"p",href:"https://github.com/nasa/cumulus/tree/master/docs/development/release.md"},"Versioning Docs"),"."),(0,o.kt)("h4",{id:"search"},"Search"),(0,o.kt)("p",null,"Search on our documentation site is taken care of by ",(0,o.kt)("a",{parentName:"p",href:"https://docsearch.algolia.com/"},"DocSearch"),". We have been provided with an ",(0,o.kt)("inlineCode",{parentName:"p"},"apiId"),", ",(0,o.kt)("inlineCode",{parentName:"p"},"apiKey")," and an ",(0,o.kt)("inlineCode",{parentName:"p"},"indexName")," by DocSearch that we include in our ",(0,o.kt)("inlineCode",{parentName:"p"},"website/docusaurus.config.js")," file. The rest, indexing and actual searching, we leave to DocSearch. Our builds expect environment variables for these values to exist - ",(0,o.kt)("inlineCode",{parentName:"p"},"DOCSEARCH_APP_ID"),", ",(0,o.kt)("inlineCode",{parentName:"p"},"DOCSEARCH_API_KEY")," and ",(0,o.kt)("inlineCode",{parentName:"p"},"DOCSEARCH_NAME_INDEX"),"."),(0,o.kt)("h4",{id:"add-a-new-task"},"Add a new task"),(0,o.kt)("p",null,"The tasks list in docs/tasks.md is generated from the list of task package in the task folder. Do not edit the docs/tasks.md file directly."),(0,o.kt)("p",null,(0,o.kt)("a",{parentName:"p",href:"/cumulus/docs/v16.1.1/adding-a-task"},"Read more about adding a new task.")),(0,o.kt)("h4",{id:"editing-the-tasksmd-header-or-template"},"Editing the tasks.md header or template"),(0,o.kt)("p",null,"Look at the ",(0,o.kt)("inlineCode",{parentName:"p"},"bin/build-tasks-doc.js")," and ",(0,o.kt)("inlineCode",{parentName:"p"},"bin/tasks-header.md")," files to edit the output of the tasks build script."),(0,o.kt)("h4",{id:"editing-diagrams"},"Editing diagrams"),(0,o.kt)("p",null,"For some diagrams included in the documentation, the raw source is included in the ",(0,o.kt)("inlineCode",{parentName:"p"},"docs/assets/raw")," directory to allow for easy updating in the future:"),(0,o.kt)("ul",null,(0,o.kt)("li",{parentName:"ul"},(0,o.kt)("inlineCode",{parentName:"li"},"assets/interfaces.svg")," -> ",(0,o.kt)("inlineCode",{parentName:"li"},"assets/raw/interfaces.drawio")," (generated using ",(0,o.kt)("a",{parentName:"li",href:"https://www.draw.io/"},"draw.io"),")")),(0,o.kt)("h3",{id:"deployment"},"Deployment"),(0,o.kt)("p",null,"The ",(0,o.kt)("inlineCode",{parentName:"p"},"master")," branch is automatically built and deployed to ",(0,o.kt)("inlineCode",{parentName:"p"},"gh-pages")," branch. The ",(0,o.kt)("inlineCode",{parentName:"p"},"gh-pages")," branch is served by Github Pages. Do not make edits to the ",(0,o.kt)("inlineCode",{parentName:"p"},"gh-pages")," branch."))}h.isMDXComponent=!0}}]);