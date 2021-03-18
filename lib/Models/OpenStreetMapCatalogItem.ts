import { computed } from "mobx";
import Rectangle from "terriajs-cesium/Source/Core/Rectangle";
import UrlTemplateImageryProvider from "terriajs-cesium/Source/Scene/UrlTemplateImageryProvider";
import URI from "urijs";
import isDefined from "../Core/isDefined";
import CatalogMemberMixin from "../ModelMixins/CatalogMemberMixin";
import OpenStreetMapCatalogItemTraits from "../Traits/OpenStreetMapCatalogItemTraits";
import MappableMixin from "../ModelMixins/MappableMixin";
import CreateModel from "./CreateModel";
import proxyCatalogItemUrl from "./proxyCatalogItemUrl";

export default class OpenStreetMapCatalogItem extends MappableMixin(
  CatalogMemberMixin(CreateModel(OpenStreetMapCatalogItemTraits))
) {
  static readonly type = "open-street-map";

  get type() {
    return OpenStreetMapCatalogItem.type;
  }

  forceLoadMetadata() {
    return Promise.resolve();
  }

  forceLoadMapItems() {
    return Promise.resolve();
  }

  @computed get mapItems() {
    const imageryProvider = this.imageryProvider;
    if (!isDefined(imageryProvider)) {
      return [];
    }
    return [
      {
        show: this.show,
        alpha: this.opacity,
        imageryProvider
      }
    ];
  }

  @computed private get imageryProvider() {
    if (!isDefined(this.templateUrl)) {
      return;
    }

    let rectangle: Rectangle | undefined;
    if (isDefined(this.rectangle)) {
      const { west, south, east, north } = this.rectangle;
      if (
        isDefined(west) &&
        isDefined(south) &&
        isDefined(east) &&
        isDefined(north)
      ) {
        rectangle = Rectangle.fromDegrees(west, south, east, north);
      }
    }

    return new UrlTemplateImageryProvider({
      url: cleanAndProxyUrl(this, this.templateUrl),
      subdomains: this.subdomains.slice(),
      credit: this.attribution,
      rectangle: rectangle,
      maximumLevel: this.maximumLevel
    });
  }

  @computed get templateUrl() {
    if (!isDefined(this.url)) {
      return;
    }

    const templateUrl = new URI(this.url);
    if (this.subdomains.length > 0 && this.url.indexOf("{s}") === -1) {
      templateUrl.hostname(`{s}.${templateUrl.hostname()}`);
    }

    const path = templateUrl.path();
    const sep = path[path.length - 1] === "/" ? "" : "/";
    templateUrl.path(`${path}${sep}{z}/{x}/{y}.${this.fileExtension}`);
    return decodeURI(templateUrl.toString());
  }
}

function cleanAndProxyUrl(catalogItem: any, url: string) {
  return proxyCatalogItemUrl(catalogItem, cleanUrl(url));
}

function cleanUrl(url: string) {
  // Strip off the search portion of the URL
  const uri = new URI(url);
  uri.search("");
  return decodeURI(url.toString());
}
