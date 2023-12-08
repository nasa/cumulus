import isIp from 'is-ip';
import { getTextObject } from '@cumulus/aws-client/S3';

export const fetchFakeProviderIp = async () => {
  if (!process.env.FAKE_PROVIDER_CONFIG_BUCKET) {
    throw new Error('The FAKE_PROVIDER_CONFIG_BUCKET environment variable must be set');
  }
  console.log('about to get text object');
  const textObject = await getTextObject(
    process.env.FAKE_PROVIDER_CONFIG_BUCKET, 'fake-provider-ip'
  );
  console.log('textObject:::', textObject);
  if (!textObject) {
    throw new Error('Failed to get object defined in FAKE_PROVIDER_CONFIG_BUCKET');
  }

  const ip = textObject.trim();

  if (!isIp(ip)) {
    throw new Error(
      `Invalid fake provider IP "${ip}" fetched from s3://${process.env.FAKE_PROVIDER_CONFIG_BUCKET}/fake-provider-ip`
    );
  }

  return ip;
};
