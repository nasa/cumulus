import sys
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job

## @params: [JOB_NAME]
args = getResolvedOptions(sys.argv, ['JOB_NAME'])
# Glue context and job setup
sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args['JOB_NAME'], args)

# Parameters
athena_database = "${athena_database}"
athena_table = "${athena_table}"
s3_bucket_path = "${s3_bucket_path}"
s3_json_files_prefix = "${s3_json_files_prefix}"
time_field = "${time_field}"

# Create a dynamic frame from S3 JSON files
dynamic_frame = glueContext.create_dynamic_frame_from_options(
    format_options={"multiline": False},
    connection_type="s3",
    format="json",
    connection_options={
        "paths": ["${s3_bucket_path}${s3_json_files_prefix}"],
        "recurse": True},
    transformation_ctx="dynamic_frame"
    )

print('Count:  ' + str(dynamic_frame.count()))
dynamic_frame.printSchema()

# Transformations or additional logic can be applied here if needed

# TODO dropDuplicates

# Write the dynamic frame to Athena
additionalOptions = {
    "enableUpdateCatalog": True,
    "updateBehavior": "UPDATE_IN_DATABASE"}
additionalOptions["partitionKeys"] = ["messageId"]
#additionalOptions["partitionKeys"] = ["region", "year", "month", "day"]
write_dynamic_frame = glueContext.write_dynamic_frame_from_catalog(
    frame = dynamic_frame,
    database = athena_database,
    table_name = athena_table,
    transformation_ctx="write_dynamic_frame",
    additional_options=additionalOptions)
print(write_dynamic_frame)
job.commit()
