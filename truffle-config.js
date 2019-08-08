require("dotenv").config();

var HDWalletProvider = require("truffle-hdwallet-provider");
const fullPathBuildDirectory = `${__dirname}/src/build/contracts`;

const seed =
  process.env.SEED ||
  "brand gallery sock inspire error kitten orphan arch unaware palace twin soft";

/*
 * NB: since truffle-hdwallet-provider 0.0.5 you must wrap HDWallet providers in a
 * function when declaring them. Failure to do so will cause commands to hang. ex:
 * ```
 * mainnet: {
 *     provider: function() {
 *       return new HDWalletProvider(mnemonic, 'https://mainnet.infura.io/<infura-key>')
 *     },
 *     network_id: '1',
 *     gas: 4500000,
 *     gasPrice: 10000000000,
 *   },
 */
const config = {
  contracts_build_directory: fullPathBuildDirectory,
  networks: {
    development: {
      host: "127.0.0.1",
      port: 8545,
      network_id: "*",
      from: process.env.FROM_ACCOUNT
    },
    rinkeby: {
      provider: () =>
        new HDWalletProvider(
          seed,
          "https://rinkeby.infura.io/v3/22218302c99b4ee29f8a5876ad0b552c"
        ),
      network_id: "4",
      // See issues:
      //   https://github.com/trufflesuite/truffle/issues/1612
      //   https://github.com/trufflesuite/truffle/issues/1698
      skipDryRun: true
    },
    mainnet: {
      provider: () =>
        new HDWalletProvider(seed, "https://node-green.mainnet.gnosis.pm"),
      network_id: "1",
      skipDryRun: true,
      gasPrice: 3e9
    }
  },
  compilers: {
    solc: {
      version: "0.5.1"
    }
  }
};

module.exports = config;
