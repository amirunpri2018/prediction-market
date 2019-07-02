import * as React from 'react';
import cn from "classnames";
import Decimal from "decimal.js-light";
import { connect } from "react-redux";
import { bindActionCreators } from "redux";
import { Route, Switch } from 'react-router-dom';
import { ConnectedRouter } from 'connected-react-router';
import * as marketDataActions from "../actions/marketData";
import Spinner from "../components/spinner";
import Markets from "./markets";
import Positions from "./Positions";
import { getNetworkName, loadWeb3 } from "../utils/web3-helpers.js";
import collateralInfo from "../utils/collateral-info";
// @ts-ignore
import TruffleContract from "truffle-contract";
import '../style.scss';

// Design components
import Header from './../components/Header/index';
import Footer from './../components/Footer/index';

// Functions
async function loadBasicData({ lmsrAddress, markets }, web3Inner, DecimalInner) {
  const { soliditySha3 } = web3Inner.utils

  const [
    { default: TruffleContract },
    { product },
    ERC20DetailedArtifact,
    IDSTokenArtifact,
    WETH9Artifact,
    PredictionMarketSystemArtifact,
    LMSRMarketMakerArtifact
  ] = await Promise.all([
    import("truffle-contract"),
    import("../utils/itertools"),
    import("../build/contracts/ERC20Detailed.json"),
    import("../build/contracts/IDSToken.json"),
    import("../build/contracts/WETH9.json"),
    import("../build/contracts/PredictionMarketSystem.json"),
    import("../build/contracts/LMSRMarketMaker.json")
  ]);

  const ERC20Detailed = TruffleContract(ERC20DetailedArtifact);
  const IDSToken = TruffleContract(IDSTokenArtifact);
  const WETH9 = TruffleContract(WETH9Artifact);
  const PredictionMarketSystem = TruffleContract(
    PredictionMarketSystemArtifact
  );
  const LMSRMarketMakerTruffle = TruffleContract(LMSRMarketMakerArtifact);
  for (const Contract of [
    ERC20Detailed,
    IDSToken,
    WETH9,
    PredictionMarketSystem,
    LMSRMarketMakerTruffle
  ]) {
    Contract.setProvider(web3Inner.currentProvider);
  }

  const LMSRMarketMaker = await LMSRMarketMakerTruffle.at(lmsrAddress);

  const collateral = await collateralInfo(
    web3Inner,
    DecimalInner,
    { ERC20Detailed, IDSToken, WETH9 },
    LMSRMarketMaker
  );

  const PMSystem = await PredictionMarketSystem.at(
    await LMSRMarketMaker.pmSystem()
  );
  const atomicOutcomeSlotCount = (await LMSRMarketMaker.atomicOutcomeSlotCount()).toNumber();

  let curAtomicOutcomeSlotCount = 1;
  for (let i = 0; i < markets.length; i++) {
    const market = markets[i];
    const conditionId = await LMSRMarketMaker.conditionIds(i);
    const numSlots = (await PMSystem.getOutcomeSlotCount(
      conditionId
    )).toNumber();

    if (numSlots === 0) {
      throw new Error(`condition ${conditionId} not set up yet`);
    }
    if (numSlots !== market.outcomes.length) {
      throw new Error(
        `condition ${conditionId} outcome slot count ${numSlots} does not match market outcome descriptions array with length ${market.outcomes.length}`
      );
    }

    market.marketIndex = i;
    market.conditionId = conditionId;
    market.outcomes.forEach((outcome, counter) => {
      outcome.collectionId = soliditySha3(
        { t: "bytes32", v: conditionId },
        // tslint:disable-next-line:no-bitwise
        { t: "uint", v: 1 << counter }
      );
    });

    curAtomicOutcomeSlotCount *= numSlots;
  }

  if (curAtomicOutcomeSlotCount !== atomicOutcomeSlotCount) {
    throw new Error(
      `mismatch in counted atomic outcome slot ${curAtomicOutcomeSlotCount} and contract reported value ${atomicOutcomeSlotCount}`
    );
  }

  const positions = [];

  const iter = product(
    ...markets
      .slice()
      .reverse()
      .map(({ conditionId, outcomes, marketIndex }) =>
        outcomes.map((outcome, outcomeIndex) => ({
          ...outcome,
          conditionId,
          marketIndex,
          outcomeIndex
        }))
      )
  );

  let outcomes = iter.next();

  while (outcomes.value) {
    const positionId = soliditySha3(
      { t: "address", v: collateral.address },
      {
        t: "uint",
        v: outcomes.value
          .map(({ collectionId }) => collectionId)
          .map(id => web3Inner.utils.toBN(id))
          .reduce((a, b) => a.add(b))
          .maskn(256)
      }
    );
    positions.push({
      id: positionId,
      outcomes
    });

    outcomes = iter.next()
  }

  positions.forEach((position, i) => {
    position.positionIndex = i;
  });

  for (const market of markets) {
    for (const outcome of market.outcomes) {
      outcome.positions = [];
    }
  }
  for (const position of positions) {
    for (const outcome of position.outcomes.value) {
      markets[outcome.marketIndex].outcomes[
        outcome.outcomeIndex
      ].positions.push(position);
    }
  }

  return {
    PMSystem,
    LMSRMarketMaker,
    collateral,
    markets,
    positions
  };
}

async function getCollateralBalance(web3Inner, collateral, account) {
  const collateralBalance = Object();
  collateralBalance.amount = await collateral.contract.balanceOf(account);
  if (collateral.isWETH) {
    collateralBalance.unwrappedAmount = web3Inner.utils.toBN(
      await web3Inner.eth.getBalance(account)
    );
    collateralBalance.totalAmount = collateralBalance.amount.add(
      collateralBalance.unwrappedAmount
    );
  } else {
    collateralBalance.totalAmount = collateralBalance.amount;
  }

  return collateralBalance;
}

async function getLMSRState(web3Inner, PMSystem, LMSRMarketMaker, positions) {
  const { fromWei } = web3Inner.utils;
  const [owner, funding, stage, fee, positionBalances] = await Promise.all([
    LMSRMarketMaker.owner(),
    LMSRMarketMaker.funding(),
    LMSRMarketMaker.stage().then(
      stageInner => ["Running", "Paused", "Closed"][stageInner.toNumber()]
    ),
    LMSRMarketMaker.fee().then(feeInner => fromWei(feeInner)),
    getPositionBalances(PMSystem, positions, LMSRMarketMaker.address)
  ]);
  return { owner, funding, stage, fee, positionBalances };
}

async function getMarketResolutionStates(PMSystem, markets) {
  return await Promise.all(
    markets.map(async ({ conditionId, outcomes }) => {
      const payoutDenominator = await PMSystem.payoutDenominator(conditionId);
      if (payoutDenominator.gtn(0)) {
        const payoutNumerators = await Promise.all(
          outcomes.map((_, outcomeIndex) =>
            PMSystem.payoutNumerators(conditionId, outcomeIndex)
          )
        );
        return Object.create({
          isResolved: true,
          payoutNumerators,
          payoutDenominator
        });
      } else {
        return Object.create({isResolved: false });
      }
    })
  );
}

async function getPositionBalances(PMSystem, positions, account) {
  return await Promise.all(
    positions.map(position => PMSystem.balanceOf(account, position.id))
  );
}

async function getLMSRAllowance(collateral, LMSRMarketMaker, account) {
  return await collateral.contract.allowance(account, LMSRMarketMaker.address);
}

Decimal.config({
  precision: 80,
  rounding: Decimal.ROUND_FLOOR
});

const moduleLoadTime = Date.now();

export interface IProps {
  setSyncTime: Function;
  loading: string,
  syncTime: number,
  setLMSRState: any,
  setMarketResolutionStates: any,
  setCollateralBalance: any,
  setPositionBalances: any,
  setLMSRAllowance: any,
  web3: Object,
  PMSystem: Object,
  LMSRMarketMaker: Object,
  positions: Array<any>,
  markets: Array<any>,
  collateral: Object,
  account: string,
  setLoading: Function,
  setNetworkId: Function,
  setWeb3: Function,
  setAccount: Function,
  setPMSystem: Function,
  setLMSRMarketMaker: Function,
  setCollateral: Function,
  setMarkets: Function,
  setPositions: Function,
  networkId: number,
  history: Object
}

export interface IState {
  marketData: Object;
}

class App extends React.Component<IProps, IState> {

  async componentDidMount () {
    // @ts-ignore
    const { setSyncTime } = this.props;

    // Set current syncTime
    setSyncTime(moduleLoadTime);

    // Save current time
    const currentTime = Date.now();

    // Repeatedly set the syncTime going forward
    setInterval(() => {
      setSyncTime(currentTime);
    }, 2000);

    // Make initial setup calls
    await this.setInitialDataFromWeb3Calls();

    this.initialStateSetupCalls();
    // window.requestAnimationFrame(() => {
    // this.makeUpdatesWhenPropsChange({syncTime: currentTime});
    // });
  }

  async componentDidUpdate(prevProps) {
    this.makeUpdatesWhenPropsChange(prevProps);
  }

  /*
   * This function is the same as the makeUpdatesWhenPropsChange() function,
   * however it doesn't have the conditionals. It simply makes the inital
   * calls without any checks.
   */
  initialStateSetupCalls = () => {
    const {
      setLMSRState,
      setMarketResolutionStates,
      setCollateralBalance,
      setPositionBalances,
      setLMSRAllowance,
      web3,
      PMSystem,
      LMSRMarketMaker,
      positions,
      markets,
      collateral,
      account
    } = this.props;

    // LMSR State
    getLMSRState(web3, PMSystem, LMSRMarketMaker, positions).then(setLMSRState);

    // Market Resolution States
    getMarketResolutionStates(PMSystem, markets).then(
      setMarketResolutionStates
    );

    // Collateral Balance
    getCollateralBalance(web3, collateral, account).then(setCollateralBalance);

    // Position Balances
    getPositionBalances(PMSystem, positions, account).then(setPositionBalances);

    // LMSR Allowance
    getLMSRAllowance(collateral, LMSRMarketMaker, account).then(
      setLMSRAllowance
    );
  };

  makeUpdatesWhenPropsChange = async prevProps => {
    const {
      loading,
      syncTime,
      setLMSRState,
      setMarketResolutionStates,
      setCollateralBalance,
      setPositionBalances,
      setLMSRAllowance,
      web3,
      PMSystem,
      LMSRMarketMaker,
      positions,
      markets,
      collateral,
      account
    } = this.props;

    // We can only execute the updates if web3 has been loaded (via the setInitialDataFromWeb3Calls() function)
    if (loading !== "SUCCESS") {
      return;
    }

    // LMSR State
    if (
      web3 !== prevProps.web3 ||
      PMSystem !== prevProps.PMSystem ||
      LMSRMarketMaker !== prevProps.LMSRMarketMaker ||
      positions !== prevProps.positions ||
      syncTime !== prevProps.syncTime
    ) {
      getLMSRState(web3, PMSystem, LMSRMarketMaker, positions).then(
        setLMSRState
      );
    }

    // Market Resolution States
    if (
      PMSystem !== prevProps.PMSystem ||
      markets !== prevProps.markets ||
      syncTime !== prevProps.syncTime
    ) {
      getMarketResolutionStates(PMSystem, markets).then(
        setMarketResolutionStates
      );
    }

    // Collateral Balance
    if (
      web3 !== prevProps.web3 ||
      collateral !== prevProps.collateral ||
      account !== prevProps.account ||
      syncTime !== prevProps.syncTime
    ) {
      getCollateralBalance(web3, collateral, account).then(
        setCollateralBalance
      );
    }

    // Position Balances
    if (
      PMSystem !== prevProps.PMSystem ||
      positions !== prevProps.positions ||
      account !== prevProps.account ||
      syncTime !== prevProps.syncTime
    ) {
      getPositionBalances(PMSystem, positions, account).then(
        setPositionBalances
      );
    }

    // LMSR Allowance
    if (
      collateral !== prevProps.collateral ||
      LMSRMarketMaker !== prevProps.LMSRMarketMaker ||
      account !== prevProps.account ||
      syncTime !== prevProps.syncTime
    ) {
      getLMSRAllowance(collateral, LMSRMarketMaker, account).then(
        setLMSRAllowance
      );
    }
  };

  setInitialDataFromWeb3Calls = async () => {
    await import("../config.json")
      .then(async ({ default: config }) => {
        const {
          setLoading,
          setNetworkId,
          setWeb3,
          setAccount,
          setPMSystem,
          setLMSRMarketMaker,
          setCollateral,
          setMarkets,
          setPositions
        } = this.props;

        setNetworkId(config.networkId);
        const { web3, account } = await loadWeb3(config.networkId);
        setWeb3(web3);
        setAccount(account);
        const {
          PMSystem,
          LMSRMarketMaker,
          collateral,
          markets,
          positions
        } = await loadBasicData(config, web3, Decimal);
        setPMSystem(PMSystem);
        setLMSRMarketMaker(LMSRMarketMaker);
        setCollateral(collateral);
        setMarkets(markets);
        setPositions(positions);

        setLoading("SUCCESS");
        return;
      });
  };

  public render() {
    const { loading, networkId, history } = this.props;

    if (loading === "SUCCESS") {
      return (
          <div className="app-main">
            <div className="app-container">
              <div className="app-main-container">
                <div className="app-header">
                  <Header />
                </div>
                <main className="app-main-content-wrapper">
                  <div className="app-main-content">
                    <div className="app-wrapper">
                      <div className="row">
                        <ConnectedRouter history={history}>
                          <Switch>
                            <Route exact path="/" component={Markets} />
                            <Route path="/positions" component={Positions} />
                          </Switch>
                        </ConnectedRouter>
                      </div>
                    </div>
                  </div>
                </main>
                <div className="app-footer">
                  <Footer/>
                </div>
              </div>
            </div>
          </div>
      );
    }

    if (loading === "LOADING") {
      return (
        <div className={cn("loading-page")}>
          <Spinner centered inverted width={100} height={100} />
        </div>
      );
    }

    if (loading === "FAILURE") {
      return (
        <div className={cn("failure-page")}>
          <h2>
            Failed to load{" "}
            <span role="img" aria-label="">
              😞
            </span>
          </h2>
          <h3>Please check the following:</h3>
          <ul>
            <li>Connect to correct network ({getNetworkName(networkId)})</li>
            <li>Install/Unlock Metamask</li>
          </ul>
        </div>
      );
    }

    // TODO Handle error messages
    return;
  }
}

export default connect(
  // @ts-ignore
  state => ({
    // @ts-ignore
    loading: state.marketData.loading,
    // @ts-ignore
    networkId: state.marketData.networkId,
    // @ts-ignore
    web3: state.marketData.web3,
    // @ts-ignore
    account: state.marketData.account,
    // @ts-ignore
    PMSystem: state.marketData.PMSystem,
    // @ts-ignore
    syncTime: state.marketData.syncTime,
    // @ts-ignore
    LMSRMarketMaker: state.marketData.LMSRMarketMaker,
    // @ts-ignore
    collateral: state.marketData.collateral,
    // @ts-ignore
    markets: state.marketData.markets,
    // @ts-ignore
    positions: state.marketData.positions,
    // @ts-ignore
    LMSRState: state.marketData.LMSRState,
    // @ts-ignore
    marketResolutionStates: state.marketData.marketResolutionStates,
    // @ts-ignore
    collateralBalance: state.marketData.collateralBalance,
    // @ts-ignore
    positionBalances: state.marketData.positionBalances,
    // @ts-ignore
    LMSRAllowance: state.marketData.LMSRAllowance,
    // @ts-ignore
    marketSelections: state.marketData.marketSelections,
    // @ts-ignore
    stagedTradeAmounts: state.marketData.stagedTradeAmounts,
    // @ts-ignore
    stagedTransactionType: state.marketData.stagedTransactionType,
  }),
  dispatch => ({
    setSyncTime: bindActionCreators(marketDataActions.setSyncTime, dispatch),
    setLoading: bindActionCreators(marketDataActions.setLoading, dispatch),
    setNetworkId: bindActionCreators(marketDataActions.setNetworkId, dispatch),
    setWeb3: bindActionCreators(marketDataActions.setWeb3, dispatch),
    setAccount: bindActionCreators(marketDataActions.setAccount, dispatch),
    setPMSystem: bindActionCreators(marketDataActions.setPMSystem, dispatch),
    setLMSRMarketMaker: bindActionCreators(
      marketDataActions.setLMSRMarketMaker,
      dispatch
    ),
    setCollateral: bindActionCreators(
      marketDataActions.setCollateral,
      dispatch
    ),
    setMarkets: bindActionCreators(marketDataActions.setMarkets, dispatch),
    setPositions: bindActionCreators(marketDataActions.setPositions, dispatch),
    setLMSRState: bindActionCreators(marketDataActions.setLMSRState, dispatch),
    setMarketResolutionStates: bindActionCreators(
      marketDataActions.setMarketResolutionStates,
      dispatch
    ),
    setCollateralBalance: bindActionCreators(
      marketDataActions.setCollateralBalance,
      dispatch
    ),
    setPositionBalances: bindActionCreators(
      marketDataActions.setPositionBalances,
      dispatch
    ),
    setLMSRAllowance: bindActionCreators(
      marketDataActions.setLMSRAllowance,
      dispatch
    ),
    setMarketSelections: bindActionCreators(
      marketDataActions.setMarketSelections,
      dispatch
    ),
    setStagedTradeAmounts: bindActionCreators(
      marketDataActions.setStagedTradeAmounts,
      dispatch
    ),
    setStagedTransactionType: bindActionCreators(
      marketDataActions.setStagedTransactionType,
      dispatch
    )
  })
)(App);
