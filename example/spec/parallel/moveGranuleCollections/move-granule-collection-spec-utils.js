
const { constructCollectionId } = require('../../../../packages/message/Collections');
const getSourceCollection = (sourceUrlPrefix) => {
	return {
		files: [
			{
				regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$',
				sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
				bucket: 'protected',
			},
			{
				regex: '^BROWSE\\.MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$',
				sampleFileName: 'BROWSE.MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
				bucket: 'private',
			},
			{
				regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf\\.met$',
				sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf.met',
				bucket: 'private',
			},
			{
				regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.cmr\\.xml$',
				sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
				bucket: 'protected',
			},
			{
				regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_2\\.jpg$',
				sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
				bucket: 'public',
			},
			{
				regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_1\\.jpg$',
				sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
				bucket: 'private',
			},
		],
		url_path: sourceUrlPrefix,
		name: 'MOD11A1',
		granuleIdExtraction: '(MOD11A1\\.(.*))\\.hdf',
		granuleId: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
		dataType: 'MOD11A1',
		process: 'modis',
		version: '006',
		sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
		id: 'MOD11A1',
	};
}

const getTargetCollection = (targetUrlPrefix) => {
	return {
		files: [
			{
				regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$',
				sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
				bucket: 'protected',
			},
			{
				regex: '^BROWSE\\.MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$',
				sampleFileName: 'BROWSE.MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
				bucket: 'private',
			},
			{
				regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf\\.met$',
				sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf.met',
				bucket: 'private',
			},
			{
				regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.cmr\\.xml$',
				sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
				bucket: 'public',
			},
			{
				regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_2\\.jpg$',
				sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
				bucket: 'public',
			},
			{
				regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_1\\.jpg$',
				sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
				bucket: 'public',
				url_path: `${targetUrlPrefix}/jpg/example2/`,
			},
		],
		url_path: targetUrlPrefix,
		name: 'MOD11A2',
		granuleIdExtraction: '(MOD11A1\\.(.*))\\.hdf',
		granuleId: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
		dataType: 'MOD11A2',
		process: 'modis',
		version: '006',
		sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
		id: 'MOD11A2',
	};
}

const getProcessGranule = (sourceUrlPrefix) => {
	return {
    status: 'completed',
    collectionId: 'MOD11A1___006',
    granuleId: 'MOD11A1.A2017200.h19v04.006.2017201090724',
    files: [
      {
        key: `${sourceUrlPrefix}/MOD11A1.A2017200.h19v04.006.2017201090724.hdf`,
        bucket: 'cumulus-test-sandbox-protected',
        type: 'data',
        fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
      },
      {
        key: `${sourceUrlPrefix}/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`,
        bucket: 'cumulus-test-sandbox-private',
        type: 'browse',
        fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
      },
      {
        key: `${sourceUrlPrefix}/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`,
        bucket: 'cumulus-test-sandbox-public',
        type: 'browse',
        fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
      },
      {
        key: `${sourceUrlPrefix}/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml`,
        bucket: 'cumulus-test-sandbox-protected',
        type: 'metadata',
        fileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
      },
    ],
  };
}

const setupInitialState = async (sourceUrlPrefix, targetUrlPrefix) => {
	const sourceCollection = getSourceCollection(sourceUrlPrefix)
	const targetCollection = getTargetCollection(targetUrlPrefix)
	try {
		await collections.createCollection({
			prefix: stackName,
			collection: sourceCollection,
		});
	} catch {
		console.log(`collection ${constructCollectionId(sourceCollection.name, sourceCollection.version)} already exists`);
	}
	try {
		await collections.createCollection({
			prefix: stackName,
			collection: targetCollection,
		});
	} catch {
		console.log(`collection ${constructCollectionId(targetCollection.name, targetCollection.version)} already exists`);
	}
	const processGranule = getProcessGranule(sourceUrlPrefix);
	try {
		await granules.createGranule({
			prefix: stackName,
			body: processGranule,
		});
	} catch {
		console.log(`granule ${processGranule.granuleId} already exists`);
	}
	await Promise.all(processGranule.files.map(async (file) => {
		let body;
		if (file.type === 'metadata') {
			body = fs.createReadStream(path.join(__dirname, 'data/meta.xml'));
		} else {
			body = file.key;
		}
		await promiseS3Upload({
			params: {
				Bucket: file.bucket,
				Key: file.key,
				Body: body,
			},
		});
	}));
}

const getPayload = (sourceUrlPrefix, targetUrlPrefix) => {
	return {
		meta: {
			collection: getTargetCollection(targetUrlPrefix),
			buckets: {
				internal: {
					type: 'cumulus-test-sandbox-internal',
				},
				private: {
					name: 'cumulus-test-sandbox-private',
					type: 'private',
				},
				protected: {
					name: 'cumulus-test-sandbox-protected',
					type: 'protected',
				},
				public: {
					name: 'cumulus-test-sandbox-public',
					type: 'public',
				},
			},
		},
		config: {
			buckets: '{$.meta.buckets}',
			distribution_endpoint: 'https://something.api.us-east-1.amazonaws.com/',
			collection: '{$.meta.collection}',
		},
		input: {
			granules: [
				getProcessGranule(sourceUrlPrefix),
			],
		},
	};
}

const getTargetFiles = (targetUrlPrefix) => {
	return [
		{
			bucket: 'cumulus-test-sandbox-protected',
			key: `${targetUrlPrefix}/MOD11A1.A2017200.h19v04.006.2017201090724.hdf`,
		},
		{
			bucket: 'cumulus-test-sandbox-public',
			key: `${targetUrlPrefix}/jpg/example2/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`,
		},
		{
			bucket: 'cumulus-test-sandbox-public',
			key: `${targetUrlPrefix}/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`,
		},
		{
			bucket: 'cumulus-test-sandbox-public',
			key: `${targetUrlPrefix}/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml`,
		},
	];
}

module.exports = {
	getSourceCollection,
	getTargetCollection,
	getProcessGranule,
	setupInitialState,
	getPayload,
	getTargetFiles
}