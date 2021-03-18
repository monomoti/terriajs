import TerrainProvider from "terriajs-cesium/Source/Core/TerrainProvider";
import DataSource from "terriajs-cesium/Source/DataSources/DataSource";
import Cesium3DTileset from "terriajs-cesium/Source/Scene/Cesium3DTileset";
import ImageryProvider from "terriajs-cesium/Source/Scene/ImageryProvider";
import AsyncLoader from "../Core/AsyncLoader";
import Constructor from "../Core/Constructor";
import Model from "../Models/Model";
import MappableTraits from "../Traits/MappableTraits";

export type MapItem =
  | ImageryParts
  | DataSource
  | Cesium3DTileset
  | TerrainProvider;

// Shouldn't this be a class?
export interface ImageryParts {
  // TODO
  alpha: number;
  // wms: boolean;
  // isGeoServer: boolean;
  show: boolean;
  imageryProvider: ImageryProvider;
}

// This discriminator only discriminates between ImageryParts and DataSource
export namespace ImageryParts {
  export function is(object: MapItem): object is ImageryParts {
    return "imageryProvider" in object;
  }
}

export function isCesium3DTileset(
  mapItem: MapItem
): mapItem is Cesium3DTileset {
  return "allTilesLoaded" in mapItem;
}

export function isTerrainProvider(
  mapItem: MapItem
): mapItem is TerrainProvider {
  return "hasVertexNormals" in mapItem;
}

export function isDataSource(object: MapItem): object is DataSource {
  return "entities" in object;
}

function MappableMixin<T extends Constructor<Model<MappableTraits>>>(Base: T) {
  abstract class MappableMixin extends Base {
    get isMappable() {
      return true;
    }

    private _mapItemsLoader = new AsyncLoader(
      this.forceLoadMapItems.bind(this)
    );

    /**
     * Gets a value indicating whether map items are currently loading.
     */
    get isLoadingMapItems(): boolean {
      return this._mapItemsLoader.isLoading;
    }

    /**
     * Loads the map items. It is safe to call this as often as necessary.
     * If the map items are already loaded or already loading, it will
     * return the existing promise.
     */
    loadMapItems(): Promise<void> {
      return this._mapItemsLoader.load();
    }

    abstract get mapItems(): MapItem[];

    /**
     * Forces load of the maps items. This method does _not_ need to consider
     * whether the map items are already loaded.
     */
    protected abstract forceLoadMapItems(): Promise<void>;

    dispose() {
      super.dispose();
      this._mapItemsLoader.dispose();
    }
  }

  return MappableMixin;
}

namespace MappableMixin {
  export interface MappableMixin
    extends InstanceType<ReturnType<typeof MappableMixin>> {}
  export function isMixedInto(model: any): model is MappableMixin {
    return model && model.isMappable;
  }
}

export default MappableMixin;
