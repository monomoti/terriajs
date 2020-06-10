"use strict";

// import Chart from "../Custom/Chart/Chart";
import Description from "./Description";
import GroupPreview from "./GroupPreview";
import InvokeFunction from "../Analytics/InvokeFunction";
import MappablePreview from "./MappablePreview";
import React from "react";
import createReactClass from "create-react-class";
import PropTypes from "prop-types";
import Styles from "./data-preview.scss";
import { withTranslation, Trans } from "react-i18next";
import { observer } from "mobx-react";
import { runInAction } from "mobx";
import ReferenceMixin from "../../ModelMixins/ReferenceMixin";
import Loader from "../Loader";

/**
 * Data preview section, for the preview map see DataPreviewMap
 */
const DataPreview = observer(
  createReactClass({
    displayName: "DataPreview",

    propTypes: {
      terria: PropTypes.object.isRequired,
      viewState: PropTypes.object,
      previewed: PropTypes.object,
      t: PropTypes.func.isRequired
    },

    backToMap() {
      runInAction(() => {
        this.props.viewState.explorerPanelIsVisible = false;
      });
    },

    render() {
      const { t } = this.props;
      let previewed = this.props.previewed;
      if (previewed !== undefined && ReferenceMixin.is(previewed)) {
        if (previewed.target === undefined) {
          // Reference is not available yet.
          return this.renderUnloadedReference();
        }
        previewed = previewed.target;
      }

      let chartData;
      if (previewed && !previewed.isMappable && previewed.tableStructure) {
        chartData = previewed.chartData();
      }

      return (
        <div
          className={Styles.preview}
          css={`
            height: ${this.props.viewState.breadcrumbsShown
              ? `calc(100% - 32px)`
              : `100%`};
          `}
        >
          <Choose>
            <When condition={previewed && previewed.isMappable}>
              <div className={Styles.previewInner}>
                <MappablePreview
                  previewed={previewed}
                  terria={this.props.terria}
                  viewState={this.props.viewState}
                />
              </div>
            </When>
            <When condition={chartData}>
              <div className={Styles.previewInner}>
                <h3 className={Styles.h3}>{previewed.name}</h3>
                <p>{t("preview.doesNotContainGeospatialData")}</p>
                <div className={Styles.previewChart}>
                  {/* TODO: Show a preview chart
                      <Chart
                         data={chartData}
                         axisLabel={{ x: previewed.xAxis.units, y: undefined }}
                         height={250 - 34}
                         />
                  */}
                </div>
                <Description item={previewed} />
              </div>
            </When>
            <When
              condition={previewed && typeof previewed.invoke !== "undefined"}
            >
              <InvokeFunction
                previewed={previewed}
                terria={this.props.terria}
                viewState={this.props.viewState}
              />
            </When>
            <When condition={previewed && previewed.isGroup}>
              <div className={Styles.previewInner}>
                <GroupPreview
                  previewed={previewed}
                  terria={this.props.terria}
                  viewState={this.props.viewState}
                />
              </div>
            </When>
            <Otherwise>
              <div className={Styles.placeholder}>
                <Trans i18nKey="preview.selectToPreview">
                  <p>Select a dataset to see a preview</p>
                  <p>- OR -</p>
                  <button
                    className={Styles.btnBackToMap}
                    onClick={this.backToMap}
                  >
                    Go to the map
                  </button>
                </Trans>
              </div>
            </Otherwise>
          </Choose>
        </div>
      );
    },

    renderUnloadedReference() {
      const isLoading = this.props.previewed.isLoadingReference;
      const hasTarget = this.props.previewed.target !== undefined;
      return (
        <div className={Styles.preview}>
          <div className={Styles.previewInner}>
            {isLoading && <Loader />}
            {!isLoading && !hasTarget && (
              <div className={Styles.placeholder}>
                <h2>Unable to resolve reference</h2>
                <p>
                  This reference could not be resolved because it is invalid or
                  because it points to something that cannot be visualised.
                </p>
              </div>
            )}
          </div>
        </div>
      );
    }
  })
);

module.exports = withTranslation()(DataPreview);
