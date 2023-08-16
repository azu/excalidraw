import React, { useEffect, useRef, useState } from "react";
import clsx from "clsx";

import type { ActionManager } from "../actions/manager";
import type { AppClassProperties, BinaryFiles, UIAppState } from "../types";

import {
  actionExportWithDarkMode,
  actionChangeExportBackground,
  actionChangeExportEmbedScene,
  actionChangeExportScale,
  actionChangeProjectName,
  actionChangeFancyBackgroundImageUrl,
} from "../actions/actionExport";
import { probablySupportsClipboardBlob } from "../clipboard";
import {
  DEFAULT_EXPORT_PADDING,
  EXPORT_IMAGE_TYPES,
  isFirefox,
  EXPORT_SCALES,
  FANCY_BACKGROUND_IMAGES,
} from "../constants";

import { canvasToBlob } from "../data/blob";
import { nativeFileSystemSupported } from "../data/filesystem";
import { NonDeletedExcalidrawElement } from "../element/types";
import { t } from "../i18n";
import { getSelectedElements, isSomeElementSelected } from "../scene";
import { exportToCanvas, getScaleToFit } from "../packages/utils";

import { copyIcon, downloadIcon, helpIcon } from "./icons";
import { Dialog } from "./Dialog";
import { RadioGroup } from "./RadioGroup";
import { Switch } from "./Switch";
import { Tooltip } from "./Tooltip";

import "./ImageExportDialog.scss";
import { useAppProps } from "./App";
import { FilledButton } from "./FilledButton";
import Select, { convertToSelectItems } from "./Select";
import { getCommonBounds } from "../element";
import { defaultExportScale, distance } from "../utils";
import { getFancyBackgroundPadding } from "../scene/fancyBackground";

const supportsContextFilters =
  "filter" in document.createElement("canvas").getContext("2d")!;

export const ErrorCanvasPreview = () => {
  return (
    <div>
      <h3>{t("canvasError.cannotShowPreview")}</h3>
      <p>
        <span>{t("canvasError.canvasTooBig")}</span>
      </p>
      <em>({t("canvasError.canvasTooBigTip")})</em>
    </div>
  );
};

type ImageExportModalProps = {
  appState: UIAppState;
  elements: readonly NonDeletedExcalidrawElement[];
  files: BinaryFiles;
  actionManager: ActionManager;
  onExportImage: AppClassProperties["onExportImage"];
};

function isBackgroundImageKey(
  key: string,
): key is keyof typeof FANCY_BACKGROUND_IMAGES {
  return key in FANCY_BACKGROUND_IMAGES;
}

const backgroundSelectItems = convertToSelectItems(
  FANCY_BACKGROUND_IMAGES,
  (item) => item.label,
);

const ImageExportModal = ({
  appState,
  elements,
  files,
  actionManager,
  onExportImage,
}: ImageExportModalProps) => {
  const appProps = useAppProps();
  const [projectName, setProjectName] = useState(appState.name);

  const someElementIsSelected = isSomeElementSelected(elements, appState);

  const [exportSelected, setExportSelected] = useState(someElementIsSelected);
  const [exportWithBackground, setExportWithBackground] = useState(
    appState.exportBackground,
  );
  const [exportBackgroundImage, setExportBackgroundImage] = useState<
    keyof typeof FANCY_BACKGROUND_IMAGES
  >(appState.fancyBackgroundImageKey);

  const [exportDarkMode, setExportDarkMode] = useState(
    appState.exportWithDarkMode,
  );
  const [embedScene, setEmbedScene] = useState(appState.exportEmbedScene);
  const [exportScale, setExportScale] = useState(appState.exportScale);
  const [exportBaseScale, setExportBaseScale] = useState(appState.exportScale);

  const previewRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState<Error | null>(null);

  const exportedElements = exportSelected
    ? getSelectedElements(elements, appState, {
        includeBoundTextElement: true,
        includeElementsInFrames: true,
      })
    : elements;

  useEffect(() => {
    if (
      exportedElements.length > 0 &&
      exportWithBackground &&
      exportBackgroundImage !== "solid"
    ) {
      const previewNode = previewRef.current;
      if (!previewNode) {
        return;
      }
      const [minX, minY, maxX, maxY] = getCommonBounds(exportedElements);
      const maxWidth = previewNode.offsetWidth;
      const maxHeight = previewNode.offsetHeight;

      const scale =
        Math.floor(
          (getScaleToFit(
            {
              width: distance(minX, maxX) + getFancyBackgroundPadding() * 2,
              height: distance(minY, maxY) + getFancyBackgroundPadding() * 2,
            },
            { width: maxWidth, height: maxHeight },
          ) +
            Number.EPSILON) *
            100,
        ) / 100;

      if (scale > 1) {
        actionManager.executeAction(actionChangeExportScale, "ui", scale);
        setExportBaseScale(scale);
      } else {
        setExportBaseScale(defaultExportScale);
      }
    } else {
      setExportBaseScale(defaultExportScale);
    }
  }, [
    actionManager,
    exportedElements,
    previewRef,
    exportWithBackground,
    exportBackgroundImage,
  ]);

  useEffect(() => {
    const previewNode = previewRef.current;
    if (!previewNode) {
      return;
    }
    const maxWidth = previewNode.offsetWidth;
    const maxHeight = previewNode.offsetHeight;

    const maxWidthOrHeight = Math.min(maxWidth, maxHeight);

    if (!maxWidth) {
      return;
    }
    exportToCanvas({
      elements: exportedElements,
      appState,
      files,
      exportPadding: DEFAULT_EXPORT_PADDING,
      maxWidthOrHeight,
    })
      .then((canvas) => {
        setRenderError(null);
        // if converting to blob fails, there's some problem that will
        // likely prevent preview and export (e.g. canvas too big)
        return canvasToBlob(canvas).then(() => {
          previewNode.replaceChildren(canvas);
        });
      })
      .catch((error) => {
        console.error(error);
        setRenderError(error);
      });
  }, [
    appState,
    appState.exportBackground,
    appState.fancyBackgroundImageKey,
    files,
    exportedElements,
  ]);

  return (
    <div className="ImageExportModal">
      <h3>{t("imageExportDialog.header")}</h3>
      <div className="ImageExportModal__preview">
        <div
          className={clsx("ImageExportModal__preview__canvas", {
            "ImageExportModal__preview__canvas--img-bcg":
              appState.exportBackground &&
              appState.fancyBackgroundImageKey &&
              appState.fancyBackgroundImageKey !== "solid",
          })}
          ref={previewRef}
        >
          {renderError && <ErrorCanvasPreview />}
        </div>
      </div>
      <div className="ImageExportModal__settings">
        <h3>{t("imageExportDialog.header")}</h3>
        {!nativeFileSystemSupported && (
          <div className="ImageExportModal__settings__filename">
            <input
              type="text"
              className="TextInput"
              value={projectName}
              disabled={
                typeof appProps.name !== "undefined" || appState.viewModeEnabled
              }
              onChange={(event) => {
                setProjectName(event.target.value);
                actionManager.executeAction(
                  actionChangeProjectName,
                  "ui",
                  event.target.value,
                );
              }}
            />
          </div>
        )}
        {someElementIsSelected && (
          <ExportSetting
            label={t("imageExportDialog.label.onlySelected")}
            name="exportOnlySelected"
          >
            <Switch
              name="exportOnlySelected"
              checked={exportSelected}
              onChange={(checked) => {
                setExportSelected(checked);
              }}
            />
          </ExportSetting>
        )}
        <ExportSetting
          label={t("imageExportDialog.label.withBackground")}
          name="exportBackgroundSwitch"
        >
          {exportWithBackground && (
            <Select
              items={backgroundSelectItems}
              ariaLabel={t("imageExportDialog.label.backgroundImage")}
              placeholder={t("imageExportDialog.label.backgroundImage")}
              value={exportBackgroundImage}
              onChange={(value) => {
                if (isBackgroundImageKey(value)) {
                  setExportBackgroundImage(value);
                  actionManager.executeAction(
                    actionChangeFancyBackgroundImageUrl,
                    "ui",
                    value,
                  );
                }
              }}
            />
          )}
          <Switch
            name="exportBackgroundSwitch"
            checked={exportWithBackground}
            onChange={(checked) => {
              setExportWithBackground(checked);
              actionManager.executeAction(
                actionChangeExportBackground,
                "ui",
                checked,
              );
            }}
          />
        </ExportSetting>
        {supportsContextFilters && (
          <ExportSetting
            label={t("imageExportDialog.label.darkMode")}
            name="exportDarkModeSwitch"
          >
            <Switch
              name="exportDarkModeSwitch"
              checked={exportDarkMode}
              onChange={(checked) => {
                setExportDarkMode(checked);
                actionManager.executeAction(
                  actionExportWithDarkMode,
                  "ui",
                  checked,
                );
              }}
            />
          </ExportSetting>
        )}
        <ExportSetting
          label={t("imageExportDialog.label.embedScene")}
          tooltip={t("imageExportDialog.tooltip.embedScene")}
          name="exportEmbedSwitch"
        >
          <Switch
            name="exportEmbedSwitch"
            checked={embedScene}
            onChange={(checked) => {
              setEmbedScene(checked);
              actionManager.executeAction(
                actionChangeExportEmbedScene,
                "ui",
                checked,
              );
            }}
          />
        </ExportSetting>
        <ExportSetting
          label={t("imageExportDialog.label.scale")}
          name="exportScale"
        >
          <RadioGroup
            name="exportScale"
            value={exportScale}
            onChange={(scale) => {
              setExportScale(scale);
              actionManager.executeAction(actionChangeExportScale, "ui", scale);
            }}
            choices={EXPORT_SCALES.map((scale) => ({
              value: scale * exportBaseScale,
              label: `${scale}\u00d7`,
            }))}
          />
        </ExportSetting>

        <div className="ImageExportModal__settings__buttons">
          <FilledButton
            className="ImageExportModal__settings__buttons__button"
            label={t("imageExportDialog.title.exportToPng")}
            onClick={() =>
              onExportImage(EXPORT_IMAGE_TYPES.png, exportedElements)
            }
            startIcon={downloadIcon}
          >
            {t("imageExportDialog.button.exportToPng")}
          </FilledButton>
          <FilledButton
            className="ImageExportModal__settings__buttons__button"
            label={t("imageExportDialog.title.exportToSvg")}
            onClick={() =>
              onExportImage(EXPORT_IMAGE_TYPES.svg, exportedElements)
            }
            startIcon={downloadIcon}
          >
            {t("imageExportDialog.button.exportToSvg")}
          </FilledButton>
          {(probablySupportsClipboardBlob || isFirefox) && (
            <FilledButton
              className="ImageExportModal__settings__buttons__button"
              label={t("imageExportDialog.title.copyPngToClipboard")}
              onClick={() =>
                onExportImage(EXPORT_IMAGE_TYPES.clipboard, exportedElements)
              }
              startIcon={copyIcon}
            >
              {t("imageExportDialog.button.copyPngToClipboard")}
            </FilledButton>
          )}
        </div>
      </div>
    </div>
  );
};

type ExportSettingProps = {
  label: string;
  children: React.ReactNode;
  tooltip?: string;
  name?: string;
};

const ExportSetting = ({
  label,
  children,
  tooltip,
  name,
}: ExportSettingProps) => {
  return (
    <div className="ImageExportModal__settings__setting" title={label}>
      <label
        htmlFor={name}
        className="ImageExportModal__settings__setting__label"
      >
        {label}
        {tooltip && (
          <Tooltip label={tooltip} long={true}>
            {helpIcon}
          </Tooltip>
        )}
      </label>
      <div className="ImageExportModal__settings__setting__content">
        {children}
      </div>
    </div>
  );
};

export const ImageExportDialog = ({
  elements,
  appState,
  files,
  actionManager,
  onExportImage,
  onCloseRequest,
}: {
  appState: UIAppState;
  elements: readonly NonDeletedExcalidrawElement[];
  files: BinaryFiles;
  actionManager: ActionManager;
  onExportImage: AppClassProperties["onExportImage"];
  onCloseRequest: () => void;
}) => {
  if (appState.openDialog !== "imageExport") {
    return null;
  }

  return (
    <Dialog onCloseRequest={onCloseRequest} size="wide" title={false}>
      <ImageExportModal
        elements={elements}
        appState={appState}
        files={files}
        actionManager={actionManager}
        onExportImage={onExportImage}
      />
    </Dialog>
  );
};
