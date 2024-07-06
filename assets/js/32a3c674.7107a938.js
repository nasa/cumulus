"use strict";(self.webpackChunk_cumulus_website=self.webpackChunk_cumulus_website||[]).push([[26106],{15680:(e,t,a)=>{a.d(t,{xA:()=>d,yg:()=>g});var r=a(96540);function o(e,t,a){return t in e?Object.defineProperty(e,t,{value:a,enumerable:!0,configurable:!0,writable:!0}):e[t]=a,e}function l(e,t){var a=Object.keys(e);if(Object.getOwnPropertySymbols){var r=Object.getOwnPropertySymbols(e);t&&(r=r.filter((function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable}))),a.push.apply(a,r)}return a}function s(e){for(var t=1;t<arguments.length;t++){var a=null!=arguments[t]?arguments[t]:{};t%2?l(Object(a),!0).forEach((function(t){o(e,t,a[t])})):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(a)):l(Object(a)).forEach((function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(a,t))}))}return e}function n(e,t){if(null==e)return{};var a,r,o=function(e,t){if(null==e)return{};var a,r,o={},l=Object.keys(e);for(r=0;r<l.length;r++)a=l[r],t.indexOf(a)>=0||(o[a]=e[a]);return o}(e,t);if(Object.getOwnPropertySymbols){var l=Object.getOwnPropertySymbols(e);for(r=0;r<l.length;r++)a=l[r],t.indexOf(a)>=0||Object.prototype.propertyIsEnumerable.call(e,a)&&(o[a]=e[a])}return o}var i=r.createContext({}),u=function(e){var t=r.useContext(i),a=t;return e&&(a="function"==typeof e?e(t):s(s({},t),e)),a},d=function(e){var t=u(e.components);return r.createElement(i.Provider,{value:t},e.children)},m="mdxType",p={inlineCode:"code",wrapper:function(e){var t=e.children;return r.createElement(r.Fragment,{},t)}},c=r.forwardRef((function(e,t){var a=e.components,o=e.mdxType,l=e.originalType,i=e.parentName,d=n(e,["components","mdxType","originalType","parentName"]),m=u(a),c=o,g=m["".concat(i,".").concat(c)]||m[c]||p[c]||l;return a?r.createElement(g,s(s({ref:t},d),{},{components:a})):r.createElement(g,s({ref:t},d))}));function g(e,t){var a=arguments,o=t&&t.mdxType;if("string"==typeof e||o){var l=a.length,s=new Array(l);s[0]=c;var n={};for(var i in t)hasOwnProperty.call(t,i)&&(n[i]=t[i]);n.originalType=e,n[m]="string"==typeof e?e:o,s[1]=n;for(var u=2;u<l;u++)s[u]=a[u];return r.createElement.apply(null,s)}return r.createElement.apply(null,a)}c.displayName="MDXCreateElement"},63490:(e,t,a)=>{a.r(t),a.d(t,{assets:()=>d,contentTitle:()=>i,default:()=>g,frontMatter:()=>n,metadata:()=>u,toc:()=>m});var r=a(58168),o=a(98587),l=(a(96540),a(15680)),s=["components"],n={id:"upgrade-rds-phase-3-release",title:"Upgrade RDS Phase 3 Release",hide_title:!1},i=void 0,u={unversionedId:"upgrade-notes/upgrade-rds-phase-3-release",id:"version-v16.1.3/upgrade-notes/upgrade-rds-phase-3-release",title:"Upgrade RDS Phase 3 Release",description:"Background",source:"@site/versioned_docs/version-v16.1.3/upgrade-notes/upgrade_rds_phase_3_release.md",sourceDirName:"upgrade-notes",slug:"/upgrade-notes/upgrade-rds-phase-3-release",permalink:"/cumulus/docs/v16.1.3/upgrade-notes/upgrade-rds-phase-3-release",draft:!1,tags:[],version:"v16.1.3",lastUpdatedBy:"Naga Nages",lastUpdatedAt:1706031284,formattedLastUpdatedAt:"Jan 23, 2024",frontMatter:{id:"upgrade-rds-phase-3-release",title:"Upgrade RDS Phase 3 Release",hide_title:!1},sidebar:"docs",previous:{title:"Upgrade to CMA 2.0.2",permalink:"/cumulus/docs/v16.1.3/upgrade-notes/update-cma-2.0.2"},next:{title:"Data Integrity & Migration Guidance (RDS Phase 3 Upgrade)",permalink:"/cumulus/docs/v16.1.3/upgrade-notes/rds-phase-3-data-migration-guidance"}},d={},m=[{value:"Background",id:"background",level:2},{value:"Requirements",id:"requirements",level:2},{value:"Suggested Prerequisites",id:"suggested-prerequisites",level:2},{value:"Upgrade procedure",id:"upgrade-procedure",level:2},{value:"1. (Optional) Halt ingest",id:"1-optional-halt-ingest",level:3},{value:"2. Deploy the data persistence module",id:"2-deploy-the-data-persistence-module",level:3},{value:"Deploy cumulus-tf module",id:"deploy-cumulus-tf-module",level:3},{value:"Possible deployment issues",id:"possible-deployment-issues",level:4},{value:"Security group deletion",id:"security-group-deletion",level:5}],p={toc:m},c="wrapper";function g(e){var t=e.components,a=(0,o.A)(e,s);return(0,l.yg)(c,(0,r.A)({},p,a,{components:t,mdxType:"MDXLayout"}),(0,l.yg)("h2",{id:"background"},"Background"),(0,l.yg)("p",null,"Release v16 of Cumulus Core includes an update to remove the now-unneeded AWS DynamoDB tables for the primary archive, as this datastore has been fully migrated to PostgreSQL databases in prior releases, and should have been operating in a parallel write mode to allow for repair/remediation of prior issues."),(0,l.yg)("h2",{id:"requirements"},"Requirements"),(0,l.yg)("p",null,"To update to this release (and beyond) users must:"),(0,l.yg)("ul",null,(0,l.yg)("li",{parentName:"ul"},"Have deployed a release of at least version 11.0.0 (preferably at least the latest supported minor version in the 11.1.x release series), having successfully completed the transition to using PostgreSQL as the primary datastore in release 11"),(0,l.yg)("li",{parentName:"ul"},"Completed evaluation of the primary datastore for data irregularities that might be resolved by re-migration of data from the DynamoDB datastores."),(0,l.yg)("li",{parentName:"ul"},"Review the CHANGELOG for any migration instructions/changes between (and including) this release and the release you're upgrading from.\n",(0,l.yg)("strong",{parentName:"li"},"Complete migration instructions from the previous release series should be included in release notes/CHANGELOG for this release"),", this document notes migration instructions specifically for release 16.0.0+, and is not all-inclusive if upgrading from multiple prior release versions."),(0,l.yg)("li",{parentName:"ul"},"Configure your deployment terraform environment to utilize the new release, noting all migration instructions."),(0,l.yg)("li",{parentName:"ul"},"The PostgreSQL database cluster should be updated to the supported version (Aurora Postgres 11.13+ compatible)")),(0,l.yg)("h2",{id:"suggested-prerequisites"},"Suggested Prerequisites"),(0,l.yg)("p",null,"In addition to the above requirements, we suggest users:"),(0,l.yg)("ul",null,(0,l.yg)("li",{parentName:"ul"},(0,l.yg)("p",{parentName:"li"},"Retain a backup of the primary DynamoDB datastore in case of recovery/integrity concerns exist between DynamoDB and PostgreSQL."),(0,l.yg)("p",{parentName:"li"}," This should only be considered if remediation/re-migration from DynamoDB has recently occurred, specifically due to the issues reported in the following tickets:"),(0,l.yg)("ul",{parentName:"li"},(0,l.yg)("li",{parentName:"ul"},"CUMULUS-3019"),(0,l.yg)("li",{parentName:"ul"},"CUMULUS-3024"),(0,l.yg)("li",{parentName:"ul"},"CUMULUS-3017")),(0,l.yg)("p",{parentName:"li"},"and other efforts included in the outcome from CUMULUS-3035/CUMULUS-3071.")),(0,l.yg)("li",{parentName:"ul"},(0,l.yg)("p",{parentName:"li"},"Halt all ingest prior to performing the version upgrade.")),(0,l.yg)("li",{parentName:"ul"},(0,l.yg)("p",{parentName:"li"},"Run load testing/functional testing."),(0,l.yg)("p",{parentName:"li"},"While the majority of the modifications for release 16 are related to DynamoDB removal, we always encourage user engineering teams ensure compatibility at scale with their deployment's configuration prior to promotion to a production environment to ensure a smooth upgrade."))),(0,l.yg)("h2",{id:"upgrade-procedure"},"Upgrade procedure"),(0,l.yg)("h3",{id:"1-optional-halt-ingest"},"1. (Optional) Halt ingest"),(0,l.yg)("p",null,"  If ingest is not halted, once the ",(0,l.yg)("inlineCode",{parentName:"p"},"data-persistence")," module is deployed but the main Core module is not deployed, existing database writes will fail, resulting in in-flight workflow messages failing to the message ",(0,l.yg)("a",{parentName:"p",href:"https://nasa.github.io/cumulus/docs/features/dead_letter_archive"},"Dead Letter Archive"),", and all API write related calls failing."),(0,l.yg)("p",null,"  While this is optional, it is ",(0,l.yg)("em",{parentName:"p"},"highly encouraged"),", as cleanup could be significant."),(0,l.yg)("h3",{id:"2-deploy-the-data-persistence-module"},"2. Deploy the data persistence module"),(0,l.yg)("p",null,"  Ensure your source for the data-persistence module is set to the release version (substituting v16.0.0 for the latest v16 release):"),(0,l.yg)("pre",null,(0,l.yg)("code",{parentName:"pre",className:"language-tf"},'  source = "https://github.com/nasa/cumulus/releases/download/v16.0.0/terraform-aws-cumulus.zip//tf-modules/data-persistence"\n')),(0,l.yg)("p",null,"  Run ",(0,l.yg)("inlineCode",{parentName:"p"},"terraform init")," to bring all updated source modules, then run ",(0,l.yg)("inlineCode",{parentName:"p"},"terraform apply")," and evaluate the changeset before proceeding.   The changeset should include blocks like the following for each table removed:"),(0,l.yg)("pre",null,(0,l.yg)("code",{parentName:"pre",className:"language-text"},"# module.data_persistence.aws_dynamodb_table.collections_table will be destroyed\n# module.data_persistence.aws_dynamodb_table.executions_table will be destroyed\n# module.data_persistence.aws_dynamodb_table.files_table will be destroyed\n# module.data_persistence.aws_dynamodb_table.granules_table will be destroyed\n# module.data_persistence.aws_dynamodb_table.pdrs_table will be destroyed\n")),(0,l.yg)("p",null,"  In addition, you should expect to see the outputs from the module remove the references to the DynamoDB tables:"),(0,l.yg)("pre",null,(0,l.yg)("code",{parentName:"pre",className:"language-text"},'Changes to Outputs:\n~ dynamo_tables = {\n      access_tokens          = {\n          arn  = "arn:aws:dynamodb:us-east-1:XXXXXX:table/prefix-AccessTokensTable"\n          name = "prefix-AccessTokensTable"\n      }\n      async_operations       = {\n          arn  = "arn:aws:dynamodb:us-east-1:XXXXXX:table/prefix-AsyncOperationsTable"\n          name = "prefix-AsyncOperationsTable"\n      }\n    - collections            = {\n        - arn  = "arn:aws:dynamodb:us-east-1:XXXXXX:table/prefix-CollectionsTable"\n        - name = "prefix-CollectionsTable"\n      } -> null\n    - executions             = {\n        - arn  = "arn:aws:dynamodb:us-east-1:XXXXXX:table/prefix-ExecutionsTable"\n        - name = "prefix-ExecutionsTable"\n      } -> null\n    - files                  = {\n        - arn  = "arn:aws:dynamodb:us-east-1:XXXXXX:table/prefix-FilesTable"\n        - name = "prefix-FilesTable"\n      } -> null\n    - granules               = {\n        - arn  = "arn:aws:dynamodb:us-east-1:XXXXXX:table/prefix-GranulesTable"\n        - name = "prefix-GranulesTable"\n      } -> null\n    - pdrs                   = {\n        - arn  = "arn:aws:dynamodb:us-east-1:XXXXXX:table/prefix-PdrsTable"\n        - name = "prefix-PdrsTable"\n      } -> null\n')),(0,l.yg)("p",null,"  Once this completes successfully, proceed to the next step."),(0,l.yg)("h3",{id:"deploy-cumulus-tf-module"},"Deploy cumulus-tf module"),(0,l.yg)("p",null,"  Ensure your source for the cumulus-tf module is set to the release version (substituting v16.0.0 for the latest v16 release):"),(0,l.yg)("pre",null,(0,l.yg)("code",{parentName:"pre",className:"language-tf"},'source = "https://github.com/nasa/cumulus/releases/download/v16.0.0/terraform-aws-cumulus.zip//tf-modules/cumulus"\n')),(0,l.yg)("p",null,"  You should expect to see a significant changeset in Core provided resources, in addition to the following resources being destroyed from the RDS Phase 3 update set:"),(0,l.yg)("pre",null,(0,l.yg)("code",{parentName:"pre",className:"language-text"},"# module.cumulus.module.archive.aws_cloudwatch_log_group.granule_files_cache_updater_logs will be destroyed\n# module.cumulus.module.archive.aws_iam_role.granule_files_cache_updater_lambda_role will be destroyed\n# module.cumulus.module.archive.aws_iam_role.migration_processing will be destroyed\n# module.cumulus.module.archive.aws_iam_role_policy.granule_files_cache_updater_lambda_role_policy will be destroyed\n# module.cumulus.module.archive.aws_iam_role_policy.migration_processing will be destroyed\n# module.cumulus.module.archive.aws_iam_role_policy.process_dead_letter_archive_role_policy will be destroyed\n# module.cumulus.module.archive.aws_iam_role_policy.publish_collections_lambda_role_policy will be destroyed\n# module.cumulus.module.archive.aws_iam_role_policy.publish_executions_lambda_role_policy will be destroyed\n# module.cumulus.module.archive.aws_iam_role_policy.publish_granules_lambda_role_policy will be destroyed\n# module.cumulus.module.archive.aws_lambda_event_source_mapping.granule_files_cache_updater will be destroyed\n# module.cumulus.module.archive.aws_lambda_event_source_mapping.publish_pdrs will be destroyed\n# module.cumulus.module.archive.aws_lambda_function.execute_migrations will be destroyed\n# module.cumulus.module.archive.aws_lambda_function.granule_files_cache_updater will be destroyed\n# module.cumulus.module.data_migration2.aws_iam_role.data_migration2 will be destroyed\n# module.cumulus.module.data_migration2.aws_iam_role_policy.data_migration2 will be destroyed\n# module.cumulus.module.data_migration2.aws_lambda_function.data_migration2 will be destroyed\n# module.cumulus.module.data_migration2.aws_security_group.data_migration2[0] will be destroyed\n# module.cumulus.module.postgres_migration_async_operation.aws_iam_role.postgres_migration_async_operation_role will be destroyed\n# module.cumulus.module.postgres_migration_async_operation.aws_iam_role_policy.postgres_migration_async_operation will be destroyed\n# module.cumulus.module.postgres_migration_async_operation.aws_lambda_function.postgres-migration-async-operation will be destroyed\n# module.cumulus.module.postgres_migration_async_operation.aws_security_group.postgres_migration_async_operation[0] will be destroyed\n# module.cumulus.module.postgres_migration_count_tool.aws_iam_role.postgres_migration_count_role will be destroyed\n# module.cumulus.module.postgres_migration_count_tool.aws_iam_role_policy.postgres_migration_count will be destroyed\n# module.cumulus.module.postgres_migration_count_tool.aws_lambda_function.postgres_migration_count_tool will be destroyed\n# module.cumulus.module.postgres_migration_count_tool.aws_security_group.postgres_migration_count[0] will be destroyed\n")),(0,l.yg)("h4",{id:"possible-deployment-issues"},"Possible deployment issues"),(0,l.yg)("h5",{id:"security-group-deletion"},"Security group deletion"),(0,l.yg)("p",null,"  The following security group resources will be deleted as part of this update:"),(0,l.yg)("pre",null,(0,l.yg)("code",{parentName:"pre",className:"language-text"},"module.cumulus.module.data_migration2.aws_security_group.data_migration2[0]\nmodule.cumulus.module.postgres_migration_count_tool.aws_security_group.postgres_migration_count[0]\nmodule.cumulus.module.postgres_migration_async_operation.aws_security_group.postgres_migration_async_operation[0]\n")),(0,l.yg)("p",null,"  Because the AWS resources associated with these security groups can take some time to be properly updated (in testing this was 20-35 minutes), these deletions may cause the deployment to take some time.   If for some unexpected reason this takes longer than expected and this causes the update to time out, you should be able to continue the deployment by re-running terraform to completion."),(0,l.yg)("p",null,"  Users may also opt to attempt to reassign the affected Network Interfaces from the Security Group/deleting the security group manually if this situation occurs and the deployment time is not desirable."))}g.isMDXComponent=!0}}]);