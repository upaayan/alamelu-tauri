const { signAsync } = require("@electron/osx-sign");

exports.default = async function signWithIdentityHash(options) {
  const identity = process.env.ALAMELU_PI_CODESIGN_IDENTITY_HASH;
  const keychain = process.env.ALAMELU_PI_CODESIGN_KEYCHAIN;
  if (!identity) {
    throw new Error("ALAMELU_PI_CODESIGN_IDENTITY_HASH is required for Alamelu Pi signing.");
  }
  if (!keychain) {
    throw new Error("ALAMELU_PI_CODESIGN_KEYCHAIN is required for Alamelu Pi signing.");
  }
  await signAsync({ ...options, identity, keychain, timestamp: false });
};
