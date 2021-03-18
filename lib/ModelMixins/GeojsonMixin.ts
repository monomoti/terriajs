import i18next from "i18next";
import { computed, observable, runInAction } from "mobx";
import Cartesian3 from "terriajs-cesium/Source/Core/Cartesian3";
import Color from "terriajs-cesium/Source/Core/Color";
import defaultValue from "terriajs-cesium/Source/Core/defaultValue";
import DeveloperError from "terriajs-cesium/Source/Core/DeveloperError";
import JulianDate from "terriajs-cesium/Source/Core/JulianDate";
import PolygonHierarchy from "terriajs-cesium/Source/Core/PolygonHierarchy";
import BillboardGraphics from "terriajs-cesium/Source/DataSources/BillboardGraphics";
import ColorMaterialProperty from "terriajs-cesium/Source/DataSources/ColorMaterialProperty";
import ConstantProperty from "terriajs-cesium/Source/DataSources/ConstantProperty";
import Entity from "terriajs-cesium/Source/DataSources/Entity";
import EntityCollection from "terriajs-cesium/Source/DataSources/EntityCollection";
import GeoJsonDataSource from "terriajs-cesium/Source/DataSources/GeoJsonDataSource";
import PointGraphics from "terriajs-cesium/Source/DataSources/PointGraphics";
import PolygonGraphics from "terriajs-cesium/Source/DataSources/PolygonGraphics";
import PolylineGraphics from "terriajs-cesium/Source/DataSources/PolylineGraphics";
import Property from "terriajs-cesium/Source/DataSources/Property";
import HeightReference from "terriajs-cesium/Source/Scene/HeightReference";
import Constructor from "../Core/Constructor";
import isDefined from "../Core/isDefined";
import JsonValue, { isJsonObject, JsonObject } from "../Core/Json";
import makeRealPromise from "../Core/makeRealPromise";
import StandardCssColors from "../Core/StandardCssColors";
import TerriaError from "../Core/TerriaError";
import MappableMixin from "./MappableMixin";
import CatalogMemberMixin from "../ModelMixins/CatalogMemberMixin";
import UrlMixin from "../ModelMixins/UrlMixin";
import Model from "../Models/Model";
import proxyCatalogItemUrl from "../Models/proxyCatalogItemUrl";
import { GeoJsonTraits } from "../Traits/GeoJsonTraits";

const formatPropertyValue = require("../Core/formatPropertyValue");
const hashFromString = require("../Core/hashFromString");
const Reproject = require("../Map/Reproject");

const simpleStyleIdentifiers = [
  "title",
  "description", //
  "marker-size",
  "marker-symbol",
  "marker-color",
  "stroke", //
  "stroke-opacity",
  "stroke-width",
  "fill",
  "fill-opacity"
];

type Coordinates = number[];

export default function GeoJsonMixin<
  T extends Constructor<Model<GeoJsonTraits>>
>(Base: T) {
  abstract class GeoJsonMixin extends MappableMixin(UrlMixin(Base)) {
    protected readonly zipFileRegex = /(\.zip\b)/i;

    readonly canZoomTo = true;

    private _dataSource: GeoJsonDataSource | undefined;
    protected _file?: File;

    @observable private _readyData?: JsonObject;

    setFileInput(file: File) {
      this._file = file;
    }

    @computed get name() {
      if (CatalogMemberMixin.isMixedInto(this.sourceReference)) {
        return super.name || this.sourceReference.name;
      }
      return super.name;
    }

    @computed get hasLocalData(): boolean {
      return isDefined(this._file);
    }

    @computed get cacheDuration(): string {
      if (isDefined(super.cacheDuration)) {
        return super.cacheDuration;
      }
      return "1d";
    }

    /**
     * Returns the final raw data after all transformations are applied.
     */
    @computed get readyData() {
      return this._readyData;
    }

    @computed get mapItems() {
      if (this.isLoadingMapItems || this._dataSource === undefined) {
        return [];
      }
      this._dataSource.show = this.show;
      return [this._dataSource];
    }

    protected forceLoadMetadata(): Promise<void> {
      return Promise.resolve();
    }

    protected forceLoadMapItems(): Promise<void> {
      const createLoadError = () =>
        new TerriaError({
          sender: this,
          title: i18next.t("models.geoJson.errorLoadingTitle"),
          message: i18next.t("models.geoJson.errorParsingMessage", {
            appName: this.terria.appName,
            email:
              '<a href="mailto:' +
              this.terria.supportEmail +
              '">' +
              this.terria.supportEmail +
              "</a>."
          })
        });

      return new Promise<JsonValue | undefined>((resolve, reject) => {
        this.customDataLoader(resolve, reject);
        if (isDefined(this._file)) {
          this.loadFromFile(this._file)
            .then(resolve)
            .catch(reject);
        } else if (isDefined(this.url)) {
          // try loading from a zip file url or a regular url
          resolve(this.loadFromUrl(this.url));
        } else {
          throw new TerriaError({
            sender: this,
            title: i18next.t("models.geoJson.unableToLoadItemTitle"),
            message: i18next.t("models.geoJson.unableToLoadItemMessage")
          });
        }
      })
        .then((geoJson: JsonValue | undefined) => {
          if (!isJsonObject(geoJson)) {
            throw createLoadError();
          }
          return reprojectToGeographic(
            geoJson,
            this.terria.configParameters.proj4ServiceBaseUrl
          );
        })
        .then((geoJsonWgs84: JsonObject) => {
          runInAction(() => {
            this._readyData = geoJsonWgs84;
          });
          return this.loadDataSource(geoJsonWgs84);
        })
        .then(dataSource => {
          this._dataSource = dataSource;
        })
        .catch(e => {
          if (e instanceof TerriaError) {
            throw e;
          } else {
            throw createLoadError();
          }
        });
    }

    private loadDataSource(geoJson: JsonObject): Promise<GeoJsonDataSource> {
      /* Style information is applied as follows, in decreasing priority:
             - simple-style properties set directly on individual features in the GeoJSON file
             - simple-style properties set as the 'Style' property on the catalog item
             - our 'options' set below (and point styling applied after Cesium loads the GeoJSON)
             - if anything is underspecified there, then Cesium's defaults come in.
             See https://github.com/mapbox/simplestyle-spec/tree/master/1.1.0
          */

      function defaultColor(
        colorString: string | undefined,
        name: string
      ): Color {
        if (colorString === undefined) {
          const color = Color.fromCssColorString(
            getRandomCssColor(StandardCssColors.highContrast, name)
          );
          color.alpha = 1;
          return color;
        } else {
          return Color.fromCssColorString(colorString) ?? Color.GRAY;
        }
      }

      function getColor(color: String | string | Color): Color {
        if (typeof color === "string" || color instanceof String) {
          return Color.fromCssColorString(color.toString()) ?? Color.GRAY;
        } else {
          return color;
        }
      }

      function parseMarkerSize(sizeString?: string): number | undefined {
        const sizes: { [name: string]: number } = {
          small: 24,
          medium: 48,
          large: 64
        };

        if (sizeString === undefined) {
          return undefined;
        }

        if (sizes[sizeString] !== undefined) {
          return sizes[sizeString];
        }
        return parseInt(sizeString, 10); // SimpleStyle doesn't allow 'marker-size: 20', but people will do it.
      }

      const style = this.style;
      const now = JulianDate.now();

      const options = {
        describe: describeWithoutUnderscores,
        markerSize: defaultValue(parseMarkerSize(style["marker-size"]), 20),
        markerSymbol: style["marker-symbol"], // and undefined if none
        markerColor: defaultColor(style["marker-color"], this.name || ""),
        stroke: getColor(defaultValue(style.stroke, "#000000")),
        strokeWidth: defaultValue(style["stroke-width"], 2),
        polygonStroke: getColor(defaultValue(style.stroke, "#000000")),
        polylineStroke: defaultColor(style.stroke, this.name || ""),
        markerOpacity: style["marker-opacity"], // not in SimpleStyle spec or supported by Cesium but see below
        fill: defaultColor(style.fill, (this.name || "") + " fill"),
        clampToGround: this.clampToGround,
        markerUrl: style["marker-url"] // not in SimpleStyle spec but gives an alternate to maki marker symbols
          ? proxyCatalogItemUrl(this, style["marker-url"])
          : undefined,
        credit: this.attribution
      };

      if (isDefined(style["stroke-opacity"])) {
        options.stroke.alpha = style["stroke-opacity"];
      }

      if (isDefined(style["fill-opacity"])) {
        options.fill.alpha = style["fill-opacity"];
      } else {
        options.fill.alpha = 0.75;
      }

      return makeRealPromise<GeoJsonDataSource>(
        GeoJsonDataSource.load(geoJson, options)
      ).then(function(dataSource) {
        const entities = dataSource.entities;
        for (let i = 0; i < entities.values.length; ++i) {
          const entity = entities.values[i];

          const properties = entity.properties;
          if (isDefined(entity.billboard) && isDefined(options.markerUrl)) {
            entity.billboard = new BillboardGraphics({
              image: new ConstantProperty(options.markerUrl),
              width:
                properties && properties["marker-width"]
                  ? new ConstantProperty(properties["marker-width"])
                  : undefined,
              height:
                properties && properties["marker-height"]
                  ? new ConstantProperty(properties["marker-height"])
                  : undefined,
              rotation:
                properties && properties["marker-angle"]
                  ? new ConstantProperty(properties["marker-angle"])
                  : undefined,
              heightReference: options.clampToGround
                ? new ConstantProperty(HeightReference.RELATIVE_TO_GROUND)
                : undefined
            });

            /* If no marker symbol was provided but Cesium has generated one for a point, then turn it into
                 a filled circle instead of the default marker. */
          } else if (
            isDefined(entity.billboard) &&
            (!properties || !isDefined(properties["marker-symbol"])) &&
            !isDefined(options.markerSymbol)
          ) {
            entity.point = new PointGraphics({
              color: new ConstantProperty(
                getColor(
                  defaultValue(
                    properties && properties["marker-color"],
                    options.markerColor
                  )
                )
              ),
              pixelSize: new ConstantProperty(
                defaultValue(
                  properties && properties["marker-size"],
                  options.markerSize / 2
                )
              ),
              outlineWidth: new ConstantProperty(
                defaultValue(
                  properties && properties["stroke-width"],
                  options.strokeWidth
                )
              ),
              outlineColor: new ConstantProperty(
                getColor(
                  defaultValue(
                    properties && properties.stroke,
                    options.polygonStroke
                  )
                )
              ),
              heightReference: new ConstantProperty(
                options.clampToGround
                  ? HeightReference.RELATIVE_TO_GROUND
                  : undefined
              )
            });
            if (
              properties &&
              isDefined(properties["marker-opacity"]) &&
              entity.point.color
            ) {
              // not part of SimpleStyle spec, but why not?
              const color: Color = entity.point.color.getValue(now);
              color.alpha = parseFloat(properties["marker-opacity"]);
            }

            entity.billboard = undefined;
          }
          if (
            isDefined(entity.billboard) &&
            properties &&
            isDefined(properties["marker-opacity"])
          ) {
            entity.billboard.color = new ConstantProperty(
              new Color(1.0, 1.0, 1.0, parseFloat(properties["marker-opacity"]))
            );
          }

          // Cesium on Windows can't render polygons with a stroke-width > 1.0.  And even on other platforms it
          // looks bad because WebGL doesn't mitre the lines together nicely.
          // As a workaround for the special case where the polygon is unfilled anyway, change it to a polyline.
          if (
            isDefined(entity.polygon) &&
            polygonHasWideOutline(entity.polygon, now) &&
            !polygonIsFilled(entity.polygon)
          ) {
            createPolylineFromPolygon(entities, entity, now);
            entity.polygon = (undefined as unknown) as PolygonGraphics;
          } else if (
            isDefined(entity.polygon) &&
            polygonHasOutline(entity.polygon, now) &&
            isPolygonOnTerrain(entity.polygon, now)
          ) {
            // Polygons don't directly support outlines when they're on terrain.
            // So create a manual outline.
            createPolylineFromPolygon(entities, entity, now);
          }
        }
        return dataSource;
      });
    }

    protected abstract async customDataLoader(
      resolve: (value: any) => void,
      reject: (reason: any) => void
    ): Promise<any>;

    protected abstract async loadFromFile(file: File): Promise<any>;
    protected abstract async loadFromUrl(url: string): Promise<any>;
  }
  return GeoJsonMixin;
}

function createPolylineFromPolygon(
  entities: EntityCollection,
  entity: Entity,
  now: JulianDate
) {
  const polygon = entity.polygon!;

  entity.polyline = new PolylineGraphics();
  entity.polyline.show = polygon.show;

  if (isPolygonOnTerrain(polygon, now)) {
    (entity.polyline as any).clampToGround = true;
  }

  if (isDefined(polygon.outlineColor)) {
    entity.polyline.material = new ColorMaterialProperty(polygon.outlineColor);
  }

  const hierarchy: PolygonHierarchy | undefined = getPropertyValue(
    polygon.hierarchy
  );

  if (!hierarchy) {
    return;
  }

  const positions = closePolyline(hierarchy.positions);

  entity.polyline.positions = new ConstantProperty(positions);
  entity.polyline.width =
    polygon.outlineWidth && polygon.outlineWidth.getValue(now);

  createEntitiesFromHoles(entities, hierarchy.holes, entity);
}

function reprojectToGeographic(
  geoJson: JsonObject,
  proj4ServiceBaseUrl?: string
): Promise<JsonObject> {
  let code: string | undefined;

  if (!isJsonObject(geoJson.crs)) {
    code = undefined;
  } else if (
    geoJson.crs.type === "EPSG" &&
    isJsonObject(geoJson.crs.properties) &&
    geoJson.crs.properties.code
  ) {
    code = "EPSG:" + geoJson.crs.properties.code;
  } else if (
    isJsonObject(geoJson.crs.properties) &&
    geoJson.crs.type === "name" &&
    geoJson.crs.properties.name
  ) {
    code = Reproject.crsStringToCode(geoJson.crs.properties.name);
  }

  geoJson.crs = {
    type: "EPSG",
    properties: {
      code: "4326"
    }
  };

  if (!Reproject.willNeedReprojecting(code)) {
    return Promise.resolve(geoJson);
  }

  return makeRealPromise<boolean>(
    Reproject.checkProjection(proj4ServiceBaseUrl, code)
  ).then(function(result: boolean) {
    if (result) {
      filterValue(geoJson, "coordinates", function(obj, prop) {
        obj[prop] = filterArray(obj[prop], function(pts) {
          if (pts.length === 0) return [];

          return reprojectPointList(pts, code);
        });
      });
      return geoJson;
    } else {
      throw new DeveloperError(
        "The crs code for this datasource is unsupported."
      );
    }
  });
}

// Reproject a point list based on the supplied crs code.
function reprojectPointList(
  pts: Coordinates | Coordinates[],
  code?: string
): Coordinates | Coordinates[] {
  if (!(pts[0] instanceof Array)) {
    return Reproject.reprojectPoint(pts, code, "EPSG:4326");
  }
  const pts_out = [];
  for (let i = 0; i < pts.length; i++) {
    pts_out.push(Reproject.reprojectPoint(pts[i], code, "EPSG:4326"));
  }
  return pts_out;
}

// Find a member by name in the gml.
function filterValue(
  obj: any,
  prop: string,
  func: (obj: any, prop: string) => void
) {
  for (let p in obj) {
    if (obj.hasOwnProperty(p) === false) {
      continue;
    } else if (p === prop) {
      if (func && typeof func === "function") {
        func(obj, prop);
      }
    } else if (typeof obj[p] === "object") {
      filterValue(obj[p], prop, func);
    }
  }
}

// Filter a geojson coordinates array structure.
function filterArray(
  pts: any[],
  func: (pts: Coordinates | Coordinates[]) => any
) {
  if (!(pts[0] instanceof Array) || !(pts[0][0] instanceof Array)) {
    pts = func(pts);
    return pts;
  }

  const result = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    result[i] = filterArray(pts[i], func); // at array of arrays of points
  }
  return result;
}

/**
 * Get a random color for the data based on the passed string (usually dataset name).
 */
function getRandomCssColor(cssColors: string[], name: string): string {
  const index = hashFromString(name || "") % cssColors.length;
  return cssColors[index];
}

// This next function modelled on Cesium.geoJsonDataSource's defaultDescribe.
function describeWithoutUnderscores(
  properties: any,
  nameProperty?: string
): string {
  let html = "";
  for (let key in properties) {
    if (properties.hasOwnProperty(key)) {
      if (key === nameProperty || simpleStyleIdentifiers.indexOf(key) !== -1) {
        continue;
      }
      let value = properties[key];
      if (typeof value === "object") {
        value = describeWithoutUnderscores(value);
      } else {
        value = formatPropertyValue(value);
      }
      key = key.replace(/_/g, " ");
      if (isDefined(value)) {
        html += "<tr><th>" + key + "</th><td>" + value + "</td></tr>";
      }
    }
  }
  if (html.length > 0) {
    html =
      '<table class="cesium-infoBox-defaultTable"><tbody>' +
      html +
      "</tbody></table>";
  }
  return html;
}

function polygonHasOutline(polygon: PolygonGraphics, now: JulianDate) {
  return (
    isDefined(polygon.outlineWidth) && polygon.outlineWidth.getValue(now) > 0
  );
}

function polygonHasWideOutline(polygon: PolygonGraphics, now: JulianDate) {
  return (
    isDefined(polygon.outlineWidth) && polygon.outlineWidth.getValue(now) > 1
  );
}

function polygonIsFilled(polygon: PolygonGraphics) {
  let fill = true;
  if (isDefined(polygon.fill)) {
    fill = polygon.fill.getValue(new JulianDate());
  }

  if (!fill) {
    return false;
  }

  if (!isDefined(polygon.material)) {
    // The default is solid white.
    return true;
  }

  let color: Color | undefined;
  if (polygon.material instanceof Color) {
    color = polygon.material.getValue(new JulianDate());
  } else {
    color = (polygon.material as ColorMaterialProperty).color?.getValue(
      new JulianDate()
    );
  }

  if (color && color.alpha === 0.0) {
    return false;
  }

  return true;
}

function closePolyline(positions: Cartesian3[]) {
  // If the first and last positions are more than a meter apart, duplicate the first position so the polyline is closed.
  if (
    positions.length >= 2 &&
    !Cartesian3.equalsEpsilon(
      positions[0],
      positions[positions.length - 1],
      0.0,
      1.0
    )
  ) {
    const copy = positions.slice();
    copy.push(positions[0]);
    return copy;
  }
  return positions;
}

function createEntitiesFromHoles(
  entityCollection: EntityCollection,
  holes: PolygonHierarchy[],
  mainEntity: Entity
) {
  if (!isDefined(holes)) {
    return;
  }

  for (let i = 0; i < holes.length; ++i) {
    createEntityFromHole(entityCollection, holes[i], mainEntity);
  }
}

function createEntityFromHole(
  entityCollection: EntityCollection,
  hole: PolygonHierarchy,
  mainEntity: Entity
) {
  if (
    !isDefined(hole) ||
    !isDefined(hole.positions) ||
    hole.positions.length === 0
  ) {
    return;
  }

  const entity = new Entity();

  entity.name = mainEntity.name;
  entity.availability = mainEntity.availability;
  entity.description = mainEntity.description;
  entity.properties = mainEntity.properties;

  entity.polyline = new PolylineGraphics();
  entity.polyline.show = mainEntity.polyline!.show;
  entity.polyline.material = mainEntity.polyline!.material;
  entity.polyline.width = mainEntity.polyline!.width;
  entity.polyline.clampToGround = mainEntity.polyline!.clampToGround;

  closePolyline(hole.positions);
  entity.polyline.positions = new ConstantProperty(hole.positions);

  entityCollection.add(entity);

  createEntitiesFromHoles(entityCollection, hole.holes, mainEntity);
}

function getPropertyValue<T>(property: Property | undefined): T | undefined {
  if (property === undefined) {
    return undefined;
  }
  return property.getValue(JulianDate.now());
}

function unwrapSinglePropertyObject(obj: any) {
  let name;
  if (Object.keys(obj).length === 1) {
    name = Object.keys(obj)[0];
    obj = obj[name];
  }
  return { name, obj };
}

function isPolygonOnTerrain(polygon: PolygonGraphics, now: JulianDate) {
  const polygonAny: any = polygon;
  const isClamped =
    polygonAny.heightReference &&
    polygonAny.heightReference.getValue(now) ===
      HeightReference.CLAMP_TO_GROUND;
  const hasPerPositionHeight =
    polygon.perPositionHeight && polygon.perPositionHeight.getValue(now);
  const hasPolygonHeight =
    polygon.height && polygon.height.getValue(now) !== undefined;

  return isClamped || (!hasPerPositionHeight && !hasPolygonHeight);
}
