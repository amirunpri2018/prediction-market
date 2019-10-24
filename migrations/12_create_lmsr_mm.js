const Decimal = require("decimal.js-light");
Decimal.config({ precision: 30 });

const deployConfig = require("./utils/deploy-config");
const writeToConfig = require("./utils/writeToConfig");

module.exports = function(deployer, network, accounts) {
  deployer.then(async () => {
    const conditionIds = [
      // ["DutchXTokenPriceOracle", deployConfig.daiPriceQuestionID],
      // ["TokenSupplyOracle", deployConfig.daiSupplyQuestionID],
      // ["DaiStabilityFeeOracle", deployConfig.daiStabilityFeeQuestionID]
      [deployConfig.ecoTreeContractAddress, deployConfig.ecoTreeQuestion0ID],
      [deployConfig.ecoTreeContractAddress, deployConfig.ecoTreeQuestion1ID],
      [deployConfig.ecoTreeContractAddress, deployConfig.ecoTreeQuestion2ID],
      [deployConfig.ecoTreeContractAddress, deployConfig.ecoTreeQuestion3ID],
      [deployConfig.ecoTreeContractAddress, deployConfig.ecoTreeQuestion4ID]
    ].map(([address, questionId]) => {
      return web3.utils.soliditySha3(
        // { t: "address", v: artifacts.require(contractName).address },
        { t: "address", v: address },
        { t: "bytes32", v: questionId },
        { t: "uint", v: 2 }
      );
    });

    const DaiStandin = artifacts.require("DaiStandin");
    const collateralToken = await DaiStandin.deployed();

    const lmsrMarketMakerFactory = await artifacts
      .require("LMSRMarketMakerFactory")
      .deployed();

    const { ammFunding } = deployConfig;
    const deployingAccount = DaiStandin.defaults()["from"];
    const collateralTokenOwner = await collateralToken.owner();
    if (collateralTokenOwner !== `0x${"00".repeat(20)}`) {
      // if the Dai standin contract has no owner, then it is the real contract
      // but if it has an owner, then it was deployed earlier and can be minted
      for (const account of accounts) {
        await collateralToken.mint(account, ammFunding, {
          from: collateralTokenOwner
        });
      }
      await collateralToken.mint(deployingAccount, ammFunding, {
        from: collateralTokenOwner
      });
    }

    await collateralToken.approve(lmsrMarketMakerFactory.address, ammFunding);

    const lmsrAddress = (await lmsrMarketMakerFactory.createLMSRMarketMaker(
      artifacts.require("PredictionMarketSystem").address,
      collateralToken.address,
      conditionIds,
      0,
      ammFunding
    )).logs.find(({ event }) => event === "LMSRMarketMakerCreation").args
      .lmsrMarketMaker;

    // const ecoTreeRegistrationTargetValue = deployConfig.ecoTreeRegistrationTargetValue.toLocaleString();

    // const formattedAXAParametricInsuranceTargetValue =
    //   "$" +
    //   deployConfig.AXAParametricInsuranceTargetValue.toLocaleString() +
    //   " DAI";

    // const ecotreeForestMarketArchitype = {
    //   title: `Will more than ${ecoTreeRegistrationTargetValue} metric tons of CO2 be absorbed by {name} by Jan 1, 2020?`,
    //   resolutionDate: new Date(
    //     deployConfig.ecoTreeRegistrationTargetTime * 1000
    //   ).toISOString(),
    //   outcomes: [
    //     {
    //       title: "Yes",
    //       short: "Yes",
    //       when: `Metric Tons Absorbed > ${ecoTreeRegistrationTargetValue}`
    //     },
    //     {
    //       title: "No",
    //       short: "No",
    //       when: `Metric Tons Absorbed ≤ ${ecoTreeRegistrationTargetValue}`
    //     }
    //   ],
    //   oracle: "FCLA + Chainlink",
    //   icon: "/assets/images/trees.jpg"
    // };

    // - Carbon offet price speculation (averaged across a parcelle area)

    const ecotreeCarbonOffetPriceArchitype = {
      title: `Will one carbon offset (one metric tonne of CO2) in the EcoTree parcelle containing {name} cost more than 4EUR on Jan 1, 2020?`,
      resolutionDate: new Date(
        deployConfig.ecoTreeRegistrationTargetTime * 1000
      ).toISOString(),
      outcomes: [
        {
          title: "Yes",
          short: "Yes",
          when: `Carbon Offset Cost > $4`
        },
        {
          title: "No",
          short: "No",
          when: `Carbon Offset Cost ≤ $4`
        }
      ],
      oracle: "Chainlink",
      icon: "/assets/images/trees.jpg"
    };

    // - Deviation of division cubage projection from future reality

    const ecotreeForestMarketArchitype = {
      title: `Will the EcoTree division containing {name} deviate above the projected cubage by more than 1.5x at harvest?`,
      resolutionDate: new Date(
        deployConfig.ecoTreeHarvestTime * 1000
      ).toISOString(),
      outcomes: [
        {
          title: "Yes",
          short: "Yes",
          when: `Upward Deviation of Division Cubage at Harvest > 1.5x`
        },
        {
          title: "No",
          short: "No",
          when: `Upward Deviation of Division Cubage at Harvest ≤ 1.5x`
        }
      ],
      oracle: "Chainlink",
      icon: "/assets/images/trees.jpg"
    };

    writeToConfig({
      networkId: await web3.eth.net.getId(),
      lmsrAddress,
      markets: [
        ...[].concat(
          Array.apply(null, Array(2)).map(
            ecotreeCarbonOffetPriceArchitype.valueOf,
            ecotreeCarbonOffetPriceArchitype
          )
        ),
        ...[].concat(
          Array.apply(null, Array(2)).map(
            ecotreeForestMarketArchitype.valueOf,
            ecotreeForestMarketArchitype
          )
        ),
        {
          title: `Will total EcoTree forestry metric cubage exceed 400,000 cubic meters by Jan 1, 2021?`,
          resolutionDate: new Date(
            deployConfig.iceAliveMeltRateTargetTime * 1000
          ).toISOString(),
          outcomes: [
            {
              title: "Yes",
              short: "Yes",
              when: `EcoTree metric cubage > 400k`
            },
            {
              title: "No",
              short: "No",
              when: `EcoTree metric cubage ≤ 400k`
            }
          ],
          oracle: "Chainlink",
          icon: "/assets/images/trees.jpg"
        }
        // {
        //   title: `Will the IceAlive Greeland ice sheet melt rate increase by at least a factor of ${deployConfig.iceAliveMeltRateTarget} from 2019 to 2020?`,
        //   resolutionDate: new Date(
        //     deployConfig.iceAliveMeltRateTargetTime * 1000
        //   ).toISOString(),
        //   outcomes: [
        //     {
        //       title: "Yes",
        //       short: "Yes",
        //       when: `Melt Rate > ${deployConfig.iceAliveMeltRateTarget}`
        //     },
        //     {
        //       title: "No",
        //       short: "No",
        //       when: `Melt Rate ≤ ${deployConfig.iceAliveMeltRateTarget}`
        //     }
        //   ],
        //   oracle: "FCLA + Chainlink",
        //   icon: "/assets/images/ice.jpg"
        // }
      ]
    });
  });
};
