import React from "react";
import PropTypes from "prop-types";
import Decimal from "decimal.js-light";
import { oneDecimal, minDisplayedProbability } from "../utils/constants";
import { formatProbability } from "../utils/formatting";

import cn from "classnames";

const OutcomesBinary = ({ probabilities, stagedProbabilities }) => {
  const color = "lightblue";
  const probability = probabilities != null ? probabilities[0] : null;

  let stagedProbability;
  let stagedProbabilityDifference;
  let absStagedProbabilityDifference;
  let shouldDisplayStagedProbability;
  let estimatedHintPosition;
  if (stagedProbabilities != null) {
    stagedProbability = stagedProbabilities[0];
    stagedProbabilityDifference = stagedProbability.sub(probability);
    absStagedProbabilityDifference = stagedProbabilityDifference.abs();
    shouldDisplayStagedProbability = absStagedProbabilityDifference.gte(
      minDisplayedProbability
    );

    estimatedHintPosition = probability.add(stagedProbability).mul(0.5);
  }

  return (
    <div className={cn("binary-outcome") + " col-12 p-0"}>
      <div className="progress">
        <div
          className="progress-bar"
          style={{
            width: probability != null ? formatProbability(probability) : "50%"
          }}
        >
          <div className="text-center">
            {probability != null ? formatProbability(probability) : "50%"}
          </div>
        </div>
        {shouldDisplayStagedProbability && (
          <>
            <div
              className={
                cn("inner-bar", "staged", {
                  inverted: stagedProbability.lt(probability),
                  "shift-left": estimatedHintPosition.lt(".2"),
                  "shift-right": estimatedHintPosition.gt(".8")
                }) + " progress-bar bg-success"
              }
              style={{
                backgroundColor: color,
                borderColor: color,
                left: stagedProbability.gt(probability)
                  ? formatProbability(probability)
                  : "auto",
                right: stagedProbability.lt(probability)
                  ? formatProbability(oneDecimal.sub(probability))
                  : "auto",
                width: formatProbability(absStagedProbabilityDifference)
              }}
            >
              <div className={cn("hint")}>
                <span className={cn("text")}>-</span>
              </div>
            </div>

            <div className={"progress-bar bg-success"}>
              <div className={cn("hint") + " text-center"}>
                <span className={cn("text") + " pl-1"}>
                  <small>PREDICTED CHANGE</small>{" "}
                  {formatProbability(stagedProbabilityDifference)}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

OutcomesBinary.propTypes = {
  probabilities: PropTypes.arrayOf(PropTypes.instanceOf(Decimal).isRequired),
  stagedProbabilities: PropTypes.arrayOf(
    PropTypes.instanceOf(Decimal).isRequired
  )
};

export default OutcomesBinary;
