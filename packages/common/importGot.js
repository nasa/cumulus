const importGot = async () => {
  const { default: got } = await import('got');
  return got;
}

module.exports = { importGot };
