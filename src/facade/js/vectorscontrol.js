/**
 * @module M/control/VectorsControl
 */

import Sortable from 'sortablejs';
import VectorsImplControl from 'impl/vectorscontrol';
import template from 'templates/vectors';
import layersTemplate from 'templates/layers';
import drawingTemplate from 'templates/drawing';
import downloadingTemplate from 'templates/downloading';
import uploadingTemplate from 'templates/uploading';
import changeNameTemplate from 'templates/changename';
import shpWrite from 'shp-write';
import tokml from 'tokml';
import togpx from 'togpx';
import * as shp from 'shpjs';
import { getValue } from './i18n/language';

const formatNumber = (x) => {
  const num = Math.round(x * 100) / 100;
  return num.toString().replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const POINTS = [1, 15];
const LINES = [10, 15];
const LINE_POINTS = [1, 15, 20, 15];

export default class VectorsControl extends M.Control {
  /**
   * @classdesc
   * Main constructor of the class. Creates a PluginControl
   * control
   *
   * @constructor
   * @extends {M.Control}
   * @api stable
   */
  constructor() {
    if (M.utils.isUndefined(VectorsImplControl)) {
      M.exception(getValue('exception.impl'));
    }

    const impl = new VectorsImplControl();
    super(impl, 'Vectors');

    // facade control goes to impl as reference param
    impl.facadeControl = this;

    /**
     * Selected Mapea feature
     * @private
     * @type {M.feature}
     */
    this.feature = undefined;

    /**
     * Feature that is drawn on selection layer around this.feature
     * to emphasize it.
     * @private
     * @type {M.feature}
     */
    this.emphasis = undefined;

    /**
     * Current geometry type selected for drawing.
     * @private
     * @type {String}
     */
    this.geometry = undefined; // Point, LineString, Polygon

    /**
     * Template that expands drawing tools with color and thickness options.
     * @private
     * @type {String}
     */
    this.drawingTools = undefined;

    /**
     * Template with uploading format options.
     * @private
     * @type {String}
     */
    this.uploadingTemplate = undefined;

    /**
     * Current color for drawing features.
     * @private
     * @type {String}
     */
    this.currentColor = undefined;

    /**
     * Current line thickness (or circle radius) for drawing features.
     * @private
     * @type {Number}
     */
    this.currentThickness = undefined;

    /**
     * Current line dash for drawing linestring features.
     * @private
     * @type {Number}
     */
    this.currentLineDash = undefined;

    /**
     * SRS of the input coordinates.
     * @private
     * @type {String}
     */
    this.srs = 'EPSG:4258';

    /**
     * Saves drawing layer ( __ draw__) from Mapea.
     * @private
     * @type {*} - Mapea layer
     */
    this.drawLayer = undefined;

    /**
     * File to upload.
     * @private
     * @type {*}
     */
    this.file_ = null;

    /**
     * Mapea layer where a square will be drawn around selected feature.
     * @private
     * @type {*}
     */
    this.selectionLayer = new M.layer.Vector({
      extract: false,
      name: 'selectLayer',
      source: this.getImpl().newVectorSource(true),
    });

    this.html = null;

    this.isEditionActive = false;

    this.isDrawingActive = false;

    this.isDownloadActive = false;

    this.pluginOpened = false;
  }

  /**
   * This function creates the view
   *
   * @public
   * @function
   * @param {M.Map} map to add the control
   * @api stable
   */
  createView(map) {
    this.map = map;
    return new Promise((success, fail) => {
      const html = M.template.compileSync(template, {
        jsonp: true,
        vars: {
          translations: {
            add_point_layer: getValue('add_point_layer'),
            add_line_layer: getValue('add_line_layer'),
            add_poly_layer: getValue('add_poly_layer'),
            load_layer: getValue('load_layer'),
          },
        },
      });
      this.html = html;
      this.renderLayers();
      success(html);
      this.addEvents(html);
      this.createDrawingTemplate();
      this.createUploadingTemplate();
      this.map.addLayers(this.selectionLayer);
    });
  }

  toogleActivate() {
    if (this.pluginOpened) {
      this.pluginOpened = false;
      // this.getImpl().removeMapEvents(this.map);
    } else {
      this.pluginOpened = true;
      // this.getImpl().addMapsEvents(this.map);
    }
  }

  renderLayers() {
    const filtered = this.map.getLayers().filter((layer) => {
      return ['kml', 'geojson', 'wfs', 'vector'].indexOf(layer.type.toLowerCase()) > -1 &&
        layer.name !== undefined && layer.name !== 'selectLayer' && layer.name !== '__draw__' && layer.name !== 'Resultado búsquedas';
    });

    const layers = [];
    filtered.forEach((layer) => {
      if (!(layer.type.toLowerCase() === 'kml' && layer.name.toLowerCase() === 'attributions')) {
        const newLayer = layer;
        const geometry = !M.utils.isNullOrEmpty(layer.geometry) ?
          layer.geometry : layer.getGeometryType();
        if (!M.utils.isNullOrEmpty(geometry) && geometry.toLowerCase().indexOf('point') > -1) {
          newLayer.point = true;
        } else if (!M.utils.isNullOrEmpty(geometry) && geometry.toLowerCase().indexOf('polygon') > -1) {
          newLayer.polygon = true;
        } else if (!M.utils.isNullOrEmpty(geometry) && geometry.toLowerCase().indexOf('line') > -1) {
          newLayer.line = true;
        }

        if (newLayer.point || newLayer.polygon || newLayer.line) {
          if (newLayer.legend === undefined) {
            newLayer.legend = newLayer.name;
          }

          newLayer.visible = layer.isVisible();
          layers.push(newLayer);
        }
      }
    });

    const html = M.template.compileSync(layersTemplate, {
      jsonp: true,
      vars: {
        layers,
        translations: {
          point_layer: getValue('point_layer'),
          line_layer: getValue('line_layer'),
          poly_layer: getValue('poly_layer'),
          show_hide: getValue('show_hide'),
          add_geom: getValue('add_geom'),
          edit_geom: getValue('edit_geom'),
          layer_zoom: getValue('layer_zoom'),
          download_layer: getValue('download_layer'),
          delete_layer: getValue('delete_layer'),
          change_name: getValue('change_name'),
        },
      },
    });

    const container = this.html.querySelector('.m-vectors-layers-container');
    container.innerHTML = '';
    if (layers.length > 0) {
      container.appendChild(html);
      html.addEventListener('click', this.clickLayer.bind(this), false);
      const layerList = this.html.querySelector('#m-vector-list');
      Sortable.create(layerList, {
        animation: 150,
        ghostClass: 'm-vectors-gray-shadow',
        onEnd: (evt) => {
          const from = evt.from;
          let maxZIndex = Math.max(...(layers.map((l) => {
            return l.getZIndex();
          })));
          from.querySelectorAll('li.m-vector-layer').forEach((elem) => {
            const name = elem.getAttribute('name');
            const filtered2 = layers.filter((layer) => {
              return layer.name === name;
            });

            if (filtered2.length > 0) {
              filtered2[0].setZIndex(maxZIndex);
              maxZIndex -= 1;
            }
          });
        },
      });
    }
  }

  /**
   * Creates drawing options template.
   * @public
   * @function
   * @api
   */
  createDrawingTemplate() {
    this.drawingTools = M.template.compileSync(drawingTemplate, {
      jsonp: true,
      vars: {
        translations: {
          color: getValue('color'),
          thickness: getValue('thickness'),
          line: getValue('line'),
          delete_geom: getValue('delete_geom'),
          query_profile: getValue('query_profile'),
        },
      },
    });
    this.currentColor = this.drawingTools.querySelector('#colorSelector').value;
    this.currentThickness = this.drawingTools.querySelector('#thicknessSelector').value;
    this.drawingTools.querySelector('#colorSelector').addEventListener('change', e => this.styleChange(e));
    this.drawingTools.querySelector('#thicknessSelector').addEventListener('change', e => this.styleChange(e));
    this.drawingTools.querySelector('button.m-vector-layer-delete-feature').addEventListener('click', () => this.deleteSingleFeature());
    this.drawingTools.querySelector('button.m-vector-layer-profile').addEventListener('click', () => this.getProfile());
    this.drawingTools.querySelector('button').style.display = 'none';
    this.drawingTools.querySelector('div.stroke-options').addEventListener('click', (e) => {
      const evt = (e || window.event);
      const selector = this.drawingTools.querySelector('div.stroke-options');
      if (evt.target.classList.contains('stroke-continuous')) {
        selector.querySelectorAll('div').forEach((elem) => {
          elem.classList.remove('active');
        });

        selector.querySelector('div.stroke-continuous').classList.add('active');
        this.currentLineDash = undefined;
      } else if (evt.target.classList.contains('stroke-dots-lines')) {
        selector.querySelectorAll('div').forEach((elem) => {
          elem.classList.remove('active');
        });

        if (evt.target.classList.contains('active')) {
          selector.querySelector('div.stroke-continuous').classList.add('active');
          this.currentLineDash = undefined;
        } else {
          selector.querySelector('div.stroke-dots-lines').classList.add('active');
          this.currentLineDash = LINE_POINTS;
        }
      } else if (evt.target.classList.contains('stroke-lines')) {
        selector.querySelectorAll('div').forEach((elem) => {
          elem.classList.remove('active');
        });

        if (evt.target.classList.contains('active')) {
          selector.querySelector('div.stroke-continuous').classList.add('active');
          this.currentLineDash = undefined;
        } else {
          selector.querySelector('div.stroke-lines').classList.add('active');
          this.currentLineDash = LINES;
        }
      } else if (evt.target.classList.contains('stroke-dots')) {
        selector.querySelectorAll('div').forEach((elem) => {
          elem.classList.remove('active');
        });

        if (evt.target.classList.contains('active')) {
          selector.querySelector('div.stroke-continuous').classList.add('active');
          this.currentLineDash = undefined;
        } else {
          selector.querySelector('div.stroke-dots').classList.add('active');
          this.currentLineDash = POINTS;
        }
      }

      this.styleChange(e);
    });
  }

  /**
   * Creates upload options template.
   *
   * @public
   * @function
   * @api
   */
  createUploadingTemplate() {
    const accept = '.kml, .zip, .gpx, .geojson';
    this.uploadingTemplate = M.template.compileSync(uploadingTemplate, {
      jsonp: true,
      vars: {
        accept,
        translations: {
          accepted: getValue('accepted'),
          select_file: getValue('select_file'),
        },
      },
    });
    const inputFile = this.uploadingTemplate.querySelector('#vectors-uploading>input');
    inputFile.addEventListener('change', evt => this.changeFile(evt, inputFile.files[0]));
  }

  /**
   * Adds event listeners to geometry buttons.
   * @public
   * @function
   * @api
   * @param {String} html - Geometry buttons template.
   */
  addEvents(html) {
    document.querySelector('.m-vectors > button.m-panel-btn').addEventListener('click', this.toogleActivate.bind(this));
    html.querySelector('#vector-add-point').addEventListener('click', this.addNewLayer.bind(this, 'Point'));
    html.querySelector('#vector-add-line').addEventListener('click', this.addNewLayer.bind(this, 'LineString'));
    html.querySelector('#vector-add-poly').addEventListener('click', this.addNewLayer.bind(this, 'Polygon'));
    html.querySelector('#vector-upload').addEventListener('click', () => this.openUploadOptions());
    this.addDragDropEvents();
  }

  addDragDropEvents() {
    document.addEventListener('dragover', (e) => {
      e.preventDefault();
    }, false);

    document.addEventListener('dragleave', (e) => {
      e.preventDefault();
    }, false);

    document.addEventListener('drop', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const files = e.dataTransfer.files;
      this.changeFile(e, files[0]);
    }, false);
  }

  addNewLayer(geom) {
    const layerName = `temp_${new Date().getTime()}`;
    const layer = new M.layer.Vector({ name: layerName, legend: layerName, extract: false });
    layer.geometry = geom;
    this.map.addLayers(layer);
    setTimeout(() => {
      document.querySelector(`li[name="${layerName}"] span.m-vector-layer-add`).click();
    }, 100);
  }

  /**
   * Changes style of current feature.
   * @public
   * @function
   * @api
   * @param {Event} e - input on.change
   */
  styleChange(e) {
    if (this.feature) {
      this.currentColor = document.querySelector('#colorSelector').value;
      this.currentThickness = document.querySelector('#thicknessSelector').value;

      switch (this.feature.getGeometry().type) {
        case 'Point':
        case 'MultiPoint':
          const newPointStyle = new M.style.Point({
            radius: this.currentThickness,
            fill: {
              color: this.currentColor,
            },
            stroke: {
              color: 'white',
              width: 2,
            },
          });
          if (this.feature !== undefined) this.feature.setStyle(newPointStyle);
          break;
        case 'LineString':
        case 'MultiLineString':
          const newLineStyle = new M.style.Line({
            stroke: {
              color: this.currentColor,
              width: this.currentThickness,
              linedash: this.currentLineDash,
            },
          });
          if (this.feature !== undefined) this.feature.setStyle(newLineStyle);
          break;
        case 'Polygon':
        case 'MultiPolygon':
          const newPolygonStyle = new M.style.Polygon({
            fill: {
              color: this.currentColor,
              opacity: 0.2,
            },
            stroke: {
              color: this.currentColor,
              width: this.currentThickness,
            },
          });
          if (this.feature !== undefined) this.feature.setStyle(newPolygonStyle);
          break;
        default:
          break;
      }
    } else if (document.querySelector('#colorSelector') !== null) {
      this.currentColor = document.querySelector('#colorSelector').value;
      this.currentThickness = document.querySelector('#thicknessSelector').value;
    }
  }

  /**
   * Sets style for a point, line or polygon feature
   * @public
   * @function
   * @api
   * @param {*} feature
   * @param {*} geometryType - Point / LineString / Polygon
   */
  setFeatureStyle(feature, geometryType) {
    switch (geometryType) {
      case 'Point':
      case 'MultiPoint':
        feature.setStyle(new M.style.Point({
          radius: this.currentThickness,
          fill: {
            color: this.currentColor,
          },
          stroke: {
            color: 'white',
            width: 2,
          },
        }));
        break;
      case 'LineString':
      case 'MultiLineString':
        feature.setStyle(new M.style.Line({
          stroke: {
            color: this.currentColor,
            width: this.currentThickness,
            linedash: this.currentLineDash,
          },
        }));
        break;
      case 'Polygon':
      case 'MultiPolygon':
        feature.setStyle(new M.style.Polygon({
          fill: {
            color: this.currentColor,
            opacity: 0.2,
          },
          stroke: {
            color: this.currentColor,
            width: Number.parseInt(this.currentThickness, 10),
          },
        }));
        break;
      default:
        throw new Error(getValue('exception.unknown_geom'));
    }
  }

  /**
   * Opens download template
   * @public
   * @function
   * @api
   */
  openDownloadOptions(layer) {
    const selector = `.m-vectors #m-vector-list li[name="${layer.name}"] .m-vector-layer-actions-container`;
    if (this.isDownloadActive) {
      document.querySelector(selector).innerHTML = '';
      this.isDownloadActive = false;
    } else {
      const html = M.template.compileSync(downloadingTemplate, {
        jsonp: true,
        vars: {
          translations: {
            download: getValue('download'),
          },
        },
      });
      document.querySelector(selector).appendChild(html);
      html.querySelector('button').addEventListener('click', this.downloadLayer.bind(this, layer));
      this.isDownloadActive = true;
    }
  }

  /**
   * Opens upload template
   * @public
   * @function
   * @api
   */
  openUploadOptions() {
    if (document.querySelector('#vectors-uploading') !== null) {
      document.querySelector('.m-vectors-general-container').innerHTML = '';
    } else {
      document.querySelector('.m-vectors-general-container').appendChild(this.uploadingTemplate);
    }
  }

  /**
   * Parses geojsonLayer removing last item on every coordinate (NaN)
   * before converting the layer to kml.
   * @public
   * @function
   * @api
   * @param {*} geojsonLayer - geojson layer with drawn features
   */
  fixGeojsonKmlBug(geojsonLayer) {
    const newGeojsonLayer = geojsonLayer;
    const features = newGeojsonLayer.features;
    features.forEach((feature) => {
      switch (feature.geometry.type) {
        case 'Point':
          if (Number.isNaN(feature.geometry.coordinates[feature.geometry.coordinates.length - 1])) {
            feature.geometry.coordinates.pop();
          }
          break;
        case 'LineString':
          if (Number
            .isNaN(feature.geometry.coordinates[0][feature.geometry.coordinates[0].length - 1])) {
            feature.geometry.coordinates.map((line) => { return line.pop(); });
          }
          break;
        case 'Poylgon':
        case 'MultiPolygon':
          feature.geometry.coordinates.forEach((coord) => {
            if (feature.geometry.type === 'Polygon' &&
              Number.isNaN(coord[0][coord[0].length - 1])) {
              coord.map((c) => {
                c.pop();
                return c;
              });
            } else if (feature.geometry.type === 'MultiPolygon' &&
              Number.isNaN(coord[0][0][coord[0][0].length - 1])) {
              coord.forEach((coordsArray) => {
                coordsArray.map((c) => {
                  c.pop();
                  return c;
                });
              });
            }
          });
          break;
        default:
      }
    });

    newGeojsonLayer.features = features;
    return newGeojsonLayer;
  }

  /**
   * Parses geojson before shp download.
   * Changes geometry type to simple when necessary and removes one pair of brackets.
   * @public
   * @function
   * @api
   * @param {*} geojsonLayer - geojson layer with drawn and uploaded features
   */
  parseGeojsonForShp(geojsonLayer) {
    const newGeoJson = geojsonLayer;
    const newFeatures = [];

    geojsonLayer.features.forEach((originalFeature) => {
      const featureType = originalFeature.geometry.type;

      if (featureType.match(/^Multi/)) {
        const features = originalFeature.geometry.coordinates
          .map((simpleFeatureCoordinates, idx) => {
            const newFeature = {
              type: 'Feature',
              id: `${originalFeature.id}${idx}`,
              geometry: {
                type: '',
                coordinates: simpleFeatureCoordinates,
              },
              properties: {},
            };
            switch (featureType) {
              case 'MultiPoint':
                newFeature.geometry.type = 'Point';
                break;
              case 'MultiLineString':
                newFeature.geometry.type = 'LineString';
                break;
              case 'MultiPolygon':
                newFeature.geometry.type = 'Polygon';
                break;
              default:
            }
            return newFeature;
          });
        newFeatures.push(...features);
      } else {
        newFeatures.push(originalFeature);
      }
    });

    newGeoJson.features = newFeatures;
    for (let i = 0; i < newGeoJson.features.length; i += 1) {
      delete newGeoJson.features[i].id;
    }
    return newGeoJson;
  }

  /**
   * Creates vector layer copy of __draw__ layer excluding text features.
   * @public
   * @function
   * @api
   * @returns {M.layer.Vector}
   */
  toGeoJSON(layer) {
    const code = this.map.getProjection().code;
    const featuresAsJSON = layer.getFeatures().map(feature => feature.getGeoJSON());
    return { type: 'FeatureCollection', features: this.geojsonTo4326(featuresAsJSON, code) };
  }

  /**
   * Downloads draw layer as GeoJSON, kml or gml.
   * @public
   * @function
   * @api
   */
  downloadLayer(layer) {
    const fileName = layer.name;
    const selector = `.m-vectors #m-vector-list li[name="${layer.name}"] .m-vector-layer-actions-container`;
    const downloadFormat = document.querySelector(selector).querySelector('select').value;
    const geojsonLayer = this.toGeoJSON(layer);
    let arrayContent;
    let mimeType;
    let extensionFormat;

    switch (downloadFormat) {
      case 'geojson':
        arrayContent = JSON.stringify(geojsonLayer);
        mimeType = 'json';
        extensionFormat = 'geojson';
        break;
      case 'kml':
        const fixedGeojsonLayer = this.fixGeojsonKmlBug(geojsonLayer);
        arrayContent = tokml(fixedGeojsonLayer);
        mimeType = 'xml';
        extensionFormat = 'kml';
        break;
      case 'gpx':
        arrayContent = togpx(geojsonLayer);
        mimeType = 'xml';
        extensionFormat = 'gpx';
        break;
      case 'shp':
        const json = this.parseGeojsonForShp(geojsonLayer);
        const options = {
          folder: fileName,
          types: {
            point: 'points',
            polygon: 'polygons',
            line: 'lines',
          },
        };
        shpWrite.download(json, options);
        break;
      default:
        M.dialog.error(getValue('exception.format_not_selected'));
        break;
    }

    if (downloadFormat !== 'shp') {
      const url = window.URL.createObjectURL(new window.Blob([arrayContent], {
        type: `application/${mimeType}`,
      }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${fileName}.${extensionFormat}`);
      document.body.appendChild(link);
      link.click();
    }

    document.querySelector(selector).innerHTML = '';
  }

  /**
   * This function compares controls
   *
   * @public
   * @function
   * @param {M.Control} control to compare
   * @api stable
   */
  equals(control) {
    return control instanceof VectorsControl;
  }

  /* Layer upload */

  /**
   * Changes selected file.
   * @public
   * @function
   * @api
   * @param {Event} evt - file input change event
   * @param {File} file - selected file on file input
   */
  changeFile(evt, file) {
    this.file_ = file;
    if (!M.utils.isNullOrEmpty(file)) {
      if (file.size > 20971520) {
        M.dialog.info(getValue('exception.size'));
        this.file_ = null;
      } else {
        this.loadLayer();
      }
    }
  }

  /**
   * Loads vector layer on map.
   * @public
   * @function
   * @api
   */
  loadLayer() {
    // eslint-disable-next-line no-bitwise
    const fileExt = this.file_.name.slice((this.file_.name.lastIndexOf('.') - 1 >>> 0) + 2);
    const fileName = this.file_.name.split('.').slice(0, -1).join('.');
    const fileReader = new window.FileReader();
    fileReader.addEventListener('load', (e) => {
      try {
        let features = [];
        if (fileExt === 'zip') {
          // In case of shp group, this unites features
          const geojsonArray = [].concat(shp.parseZip(fileReader.result));
          features = this.getImpl().loadAllInGeoJSONLayer(geojsonArray, fileName);
        } else if (fileExt === 'kml') {
          features = this.getImpl().loadKMLLayer(fileReader.result, fileName, false);
        } else if (fileExt === 'gpx') {
          features = this.getImpl().loadGPXLayer(fileReader.result, fileName);
        } else if (fileExt === 'geojson') {
          features = this.getImpl().loadGeoJSONLayer(fileReader.result, fileName);
        } else {
          M.dialog.error(getValue('exception.load'));
          return;
        }
        if (features.length === 0) {
          M.dialog.info(getValue('exception.no_geoms'));
        } else {
          this.getImpl().centerFeatures(features);
        }
      } catch (error) {
        M.dialog.error(getValue('exception.load_correct'));
      }
    });

    if (fileExt === 'zip') {
      fileReader.readAsArrayBuffer(this.file_);
    } else if (fileExt === 'kml' || fileExt === 'gpx' || fileExt === 'geojson') {
      fileReader.readAsText(this.file_);
    } else {
      M.dialog.error(getValue('exception.extension'));
    }
  }

  /**
   * Creates GeoJSON feature from a previous feature and a new set of coordinates.
   * @public
   * @function
   * @api
   * @param {GeoJSON Feature} previousFeature
   * @param {Array} coordinates
   */
  createGeoJSONFeature(previousFeature, coordinates) {
    return {
      ...previousFeature,
      geometry: {
        type: previousFeature.geometry.type,
        coordinates,
      },
    };
  }

  /**
   * Converts features coordinates on geojson format to 4326.
   * @public
   * @function
   */
  geojsonTo4326(featuresAsJSON, codeProjection) {
    const jsonResult = [];
    featuresAsJSON.forEach((featureAsJSON) => {
      const coordinates = featureAsJSON.geometry.coordinates;
      let newCoordinates = [];
      switch (featureAsJSON.geometry.type) {
        case 'Point':
          newCoordinates = this.getImpl().getTransformedCoordinates(codeProjection, coordinates);
          break;
        case 'MultiPoint':
          for (let i = 0; i < coordinates.length; i += 1) {
            const newDot = this
              .getImpl().getTransformedCoordinates(codeProjection, coordinates[i]);
            newCoordinates.push(newDot);
          }
          break;
        case 'LineString':
          for (let i = 0; i < coordinates.length; i += 1) {
            const newDot = this.getImpl().getTransformedCoordinates(
              codeProjection,
              coordinates[i],
            );
            newCoordinates.push(newDot);
          }
          break;
        case 'MultiLineString':
          for (let i = 0; i < coordinates.length; i += 1) {
            const newLine = [];
            for (let j = 0; j < coordinates[i].length; j += 1) {
              const newDot = this
                .getImpl().getTransformedCoordinates(codeProjection, coordinates[i][j]);
              newLine.push(newDot);
            }
            newCoordinates.push(newLine);
          }
          break;
        case 'Polygon':
          for (let i = 0; i < coordinates.length; i += 1) {
            const newPoly = [];
            for (let j = 0; j < coordinates[i].length; j += 1) {
              const newDot = this
                .getImpl().getTransformedCoordinates(codeProjection, coordinates[i][j]);
              newPoly.push(newDot);
            }
            newCoordinates.push(newPoly);
          }
          break;
        case 'MultiPolygon':
          for (let i = 0; i < coordinates.length; i += 1) {
            const newPolygon = [];
            for (let j = 0; j < coordinates[i].length; j += 1) {
              const newPolygonLine = [];
              for (let k = 0; k < coordinates[i][j].length; k += 1) {
                const newDot = this
                  .getImpl().getTransformedCoordinates(codeProjection, coordinates[i][j][k]);
                newPolygonLine.push(newDot);
              }
              newPolygon.push(newPolygonLine);
            }
            newCoordinates.push(newPolygon);
          }
          break;
        default:
      }
      const jsonFeature = this.createGeoJSONFeature(featureAsJSON, newCoordinates);
      jsonResult.push(jsonFeature);
    });
    return jsonResult;
  }

  /**
   * Modifies drawing tools, updates inputs, emphasizes selection
   * and shows feature info on select.
   * @public
   * @function
   * @api
   * @param {Event}
   */
  onSelect(e) {
    const MFeatures = this.drawLayer.getFeatures();
    const olFeature = e.target.getFeatures().getArray()[0];
    this.feature = MFeatures.filter(f => f.getImpl().getOLFeature() === olFeature)[0] || undefined;
    this.geometry = this.feature.getGeometry().type;
    const selector = `#m-vector-list li[name="${this.drawLayer.name}"] div.m-vector-layer-actions-container`;
    document.querySelector(selector).appendChild(this.drawingTools);
    document.querySelector('div.m-vector-layer-actions-container #drawingtools button').style.display = 'block';
    if (document.querySelector('.ol-profil.ol-unselectable.ol-control') !== null) {
      document.querySelector('.ol-profil.ol-unselectable.ol-control').remove();
    }

    this.emphasizeSelectedFeature();
    this.showFeatureInfo();
  }

  /**
   * Emphasizes selection and shows feature info after feature is modified.
   * @public
   * @function
   * @api
   */
  onModify() {
    this.emphasizeSelectedFeature();
    this.showFeatureInfo();
    // Asegurar que el estilo actual se mantenga después de la modificación
    if (this.feature) {
      // Llamar a styleChange para aplicar el estilo actual a la feature modificada
      this.styleChange();
    }
  }

  /**
   * Controls clicks events of each layer
   * @public
   * @function
   * @api stable
   */
  clickLayer(evtParameter) {
    const evt = (evtParameter || window.event);
    const layerName = evt.target.getAttribute('data-layer-name');
    let render = false;
    if (!M.utils.isNullOrEmpty(layerName)) {
      evt.stopPropagation();
      const layer = this.map.getLayers().filter(l => l.name === layerName)[0];
      if (evt.target.classList.contains('m-vector-layer-legend-change')) {
        const changeName = M.template.compileSync(changeNameTemplate, {
          jsonp: true,
          parseToHtml: false,
          vars: {
            name: layer.legend || layer.name,
            translations: {
              change: getValue('change'),
            },
          },
        });

        M.dialog.info(changeName, getValue('change_name'));
        setTimeout(() => {
          const selector = 'div.m-mapea-container div.m-dialog #m-layer-change-name button';
          document.querySelector(selector).addEventListener('click', this.changeLayerLegend.bind(this, layer));
          document.querySelector('div.m-mapea-container div.m-dialog div.m-title').style.backgroundColor = '#16b90d';
          const button = document.querySelector('div.m-dialog.info div.m-button > button');
          button.innerHTML = getValue('close');
          button.style.width = '75px';
          button.style.backgroundColor = '#16b90d';
        }, 10);
      } else if (evt.target.classList.contains('m-vector-layer-add')) {
        this.isDownloadActive = false;
        this.openDrawOptions(layer);
      } else if (evt.target.classList.contains('m-vector-layer-edit')) {
        this.isDownloadActive = false;
        this.openEditOptions(layer);
      } else if (evt.target.classList.contains('m-vector-layer-zoom')) {
        this.isDownloadActive = false;
        this.resetInteractions();
        if (layer.type === 'WFS' || (layer.type === 'Vector' && layer.getFeatures().length > 0)) {
          const extent = layer.getMaxExtent();
          this.map.setBbox(extent);
        } else if (layer.type === 'KML') {
          const extent = layer.getImpl().getExtent();
          this.map.setBbox(extent);
        } else if (layer.type === 'GeoJSON') {
          const extent = layer.getFeaturesExtent();
          this.map.setBbox(extent);
        } else {
          M.dialog.info(getValue('exception.not_extent'), getValue('info'));
        }
      } else if (evt.target.classList.contains('m-vector-layer-toogle')) {
        this.isDownloadActive = false;
        this.resetInteractions();
        layer.setVisible(!layer.visible);
        layer.visible = !layer.visible;
        render = true;
      } else if (evt.target.classList.contains('m-vector-layer-download')) {
        this.resetInteractions();
        this.openDownloadOptions(layer);
      } else if (evt.target.classList.contains('m-vector-layer-delete')) {
        this.isDownloadActive = false;
        this.resetInteractions();
        this.map.removeLayers(layer);
        render = true;
      }
    }

    if (render) {
      this.renderLayers();
    }
  }

  /**
   * Preserva los estilos de todas las features en una capa
   * @private
   * @function
   * @param {M.layer} layer - Capa que contiene las features
   */
  preserveFeatureStyles(layer) {
    const features = layer.getFeatures();
    features.forEach((feature) => {
      if (feature.getStyle()) {
        // Guardar el estilo actual y volver a aplicarlo para asegurar que persista
        const currentStyle = feature.getStyle();
        feature.setStyle(currentStyle);
      }
    });
  }

  resetInteractions() {
    this.deactivateDrawing();
    this.deactivateSelection();
    this.isDrawingActive = false;
    this.isEditionActive = false;
    // Preservar los estilos de las features en la capa actual
    if (this.drawLayer) {
      this.preserveFeatureStyles(this.drawLayer);
    }
    this.drawLayer = undefined;
    // this.getImpl().addMapsEvents(this.map);
  }

  changeLayerLegend(layer) {
    const selector = 'div.m-mapea-container div.m-dialog #m-layer-change-name input';
    const newValue = document.querySelector(selector).value.trim();
    if (newValue.length > 0) {
      layer.setLegend(newValue);
      this.renderLayers();
      document.querySelector('div.m-mapea-container div.m-dialog').remove();
    }
  }

  openDrawOptions(layer) {
    this.isEditionActive = false;
    this.deactivateSelection();
    this.deactivateDrawing();
    const cond = this.drawLayer !== undefined && layer.name !== this.drawLayer.name;
    if (cond || !this.isDrawingActive) {
      // this.getImpl().removeMapEvents(this.map);
      this.drawLayer = layer;
      this.isDrawingActive = true;
      this.drawingTools.querySelector('button').style.display = 'none';
      const selector = `#m-vector-list li[name="${layer.name}"] div.m-vector-layer-actions-container`;
      const selector2 = `#m-vector-list li[name="${layer.name}"] div.m-vector-layer-actions .m-vector-layer-add`;
      document.querySelector(selector).appendChild(this.drawingTools);
      document.querySelector(selector2).classList.add('active-tool');
      this.getImpl().addDrawInteraction(layer);
      if (document.querySelector('#drawingtools #featureInfo') !== null) {
        document.querySelector('#drawingtools #featureInfo').style.display = 'none';
      }
    } else {
      // this.getImpl().addMapsEvents(this.map);
      this.isDrawingActive = false;
      this.drawLayer = undefined;
    }
  }

  openEditOptions(layer) {
    this.isDrawingActive = false;
    this.deactivateSelection();
    this.deactivateDrawing();
    const cond = this.drawLayer !== undefined && layer.name !== this.drawLayer.name;
    if (cond || !this.isEditionActive) {
      // this.getImpl().removeMapEvents(this.map);
      if (layer.getFeatures().length > 0) {
        this.drawLayer = layer;
        this.isEditionActive = true;
        this.getImpl().activateSelection(layer);
        const selector = `#m-vector-list li[name="${layer.name}"] div.m-vector-layer-actions .m-vector-layer-edit`;
        document.querySelector(selector).classList.add('active-tool');
      } else {
        M.dialog.error(getValue('exception.no_features'), getValue('warning'));
      }
    } else {
      this.preserveFeatureStyles(layer);
      // this.getImpl().addMapsEvents(this.map);
      this.isEditionActive = false;
      this.drawLayer = undefined;
    }
  }

  /**
   * Checks if any drawing button is active and deactivates it,
   * deleting drawing interaction.
   * @public
   * @function
   * @api
   */
  deactivateDrawing() {
    const selector = '.m-vectors #m-vector-list div.m-vector-layer-actions-container';
    const selector2 = '#m-vector-list div.m-vector-layer-actions span';
    document.querySelectorAll(selector).forEach((elem) => {
      /* eslint-disable no-param-reassign */
      elem.innerHTML = '';
    });

    document.querySelectorAll(selector2).forEach((elem) => {
      /* eslint-disable no-param-reassign */
      elem.classList.remove('active-tool');
    });

    this.feature = undefined;
    this.emphasizeSelectedFeature();
    this.getImpl().removeDrawInteraction();
  }

  /**
   * Deletes selected geometry.
   * @public
   * @function
   * @api
   */
  deleteSingleFeature() {
    this.drawLayer.removeFeatures([this.feature]);
    this.feature = undefined;
    this.geometry = undefined;
    this.selectionLayer.removeFeatures([this.emphasis]);
    if (this.isEditionActive) {
      this.isEditionActive = false;
      this.openEditOptions(this.drawLayer);
    }
  }

  /**
   * After draw interaction event is over,
   * updates feature style, inputs, adds feature to draw layer,
   * shows feature info and emphasizes it.
   * @public
   * @function
   * @api
   * @param {Event} event - 'drawend' triggering event
   */
  onDraw(event) {
    this.feature = event.feature;
    this.feature.setId(`${this.drawLayer.name}.${new Date().getTime()}`);
    this.feature = M.impl.Feature.olFeature2Facade(this.feature);
    this.geometry = this.feature.getGeometry().type;
    this.setFeatureStyle(this.feature, this.geometry);
    document.querySelector('.m-vectors #drawingtools button').style.display = 'block';
    this.drawLayer.addFeatures(this.feature);
    this.emphasizeSelectedFeature();
    this.showFeatureInfo();
  }

  /**
   * Clears selection layer.
   * Draws square around feature and adds it to selection layer.
   * For points:
   *    If feature doesn't have style, sets new style.
   * @public
   * @function
   * @api
   */
  emphasizeSelectedFeature() {
    this.emphasis = null;
    this.selectionLayer.removeFeatures(this.selectionLayer.getFeatures());

    if (this.feature) {
      if ((this.geometry === 'Point' || this.geometry === 'MultiPoint')) {
        this.emphasis = this.getImpl().getMapeaFeatureClone();
        this.emphasis.setStyle(new M.style.Point({
          radius: 20,
          stroke: {
            color: '#FF0000',
            width: 2,
          },
        }));
      } else {
        // eslint-disable-next-line no-underscore-dangle
        const extent = this.getImpl().getFeatureExtent();
        this.emphasis = M.impl.Feature.olFeature2Facade(this.getImpl().newPolygonFeature(extent));
        this.emphasis.setStyle(new M.style.Line({
          stroke: {
            color: '#FF0000',
            width: 2,
          },
        }));
      }
      this.selectionLayer.addFeatures([this.emphasis]);
    }
  }

  /**
   * On select, shows feature info.
   * @public
   * @function
   * @api
   */
  showFeatureInfo() {
    const infoContainer = document.querySelector('#drawingtools #featureInfo');
    document.querySelector('#drawingtools button.m-vector-layer-profile').style.display = 'none';
    if (infoContainer !== null) {
      infoContainer.style.display = 'block';
      infoContainer.innerHTML = '';
    }

    switch (this.geometry) {
      case 'Point':
      case 'MultiPoint':
        const x = this.getImpl().getFeatureCoordinates()[0];
        const y = this.getImpl().getFeatureCoordinates()[1];
        if (infoContainer !== null) {
          document.querySelector('#drawingtools div.stroke-container').style.display = 'none';
          infoContainer.innerHTML = `${getValue('coordinates')}<br/>
          x: ${Math.round(x * 1000) / 1000},<br/>
          y: ${Math.round(y * 1000) / 1000}`;
          if (this.feature.getStyle() !== undefined && this.feature.getStyle() !== null) {
            const style = this.feature.getStyle().getOptions();
            this.currentColor = style.fill.color;
            document.querySelector('#colorSelector').value = style.fill.color;
            this.currentThickness = style.radius || 6;
            document.querySelector('#thicknessSelector').value = style.radius || 6;
          }
        }
        break;
      case 'LineString':
      case 'MultiLineString':
        const lineLength = this.getImpl().getFeatureLength();
        const m = formatNumber(lineLength);
        const km = formatNumber(lineLength / 1000);
        if (infoContainer !== null) {
          document.querySelector('#drawingtools div.stroke-container').style.display = 'block';
          let html = `<table class="m-vectors-results-table"><thead><tr><td colspan="3">${getValue('length')}</td></tr></thead><tbody>`;
          html += `<tr><td>m</td><td>${m}</td></tr>`;
          html += `<tr><td>km</td><td>${km}</td></tr>`;
          html += '</tbody></table>';
          infoContainer.innerHTML = html;
          if (this.feature.getStyle() !== undefined && this.feature.getStyle() !== null) {
            const stroke = this.feature.getStyle().getOptions().stroke;
            this.currentColor = stroke.color;
            document.querySelector('#colorSelector').value = stroke.color;
            this.currentThickness = stroke.width || 6;
            document.querySelector('#thicknessSelector').value = stroke.width || 6;
            this.currentLineDash = stroke.linedash;
            const selector = this.drawingTools.querySelector('div.stroke-options');
            selector.querySelectorAll('div').forEach((elem) => {
              elem.classList.remove('active');
            });

            if (stroke.linedash !== undefined && stroke.linedash.length > 2) {
              selector.querySelector('div.stroke-dots-lines').classList.add('active');
            } else if (stroke.linedash !== undefined && stroke.linedash[0] > 2) {
              selector.querySelector('div.stroke-lines').classList.add('active');
            } else if (stroke.linedash !== undefined && stroke.linedash[0] < 2) {
              selector.querySelector('div.stroke-dots').classList.add('active');
            } else {
              selector.querySelector('div.stroke-continuous').classList.add('active');
            }
          }

          if (this.geometry === 'LineString') {
            document.querySelector('#drawingtools button.m-vector-layer-profile').style.display = 'block';
          }
        }
        break;
      case 'Polygon':
      case 'MultiPolygon':
        const area = this.getImpl().getFeatureArea();
        const m2 = formatNumber(area);
        const km2 = formatNumber(area / 1000000);
        const ha = formatNumber(area / 10000);
        if (infoContainer !== null) {
          document.querySelector('#drawingtools div.stroke-container').style.display = 'none';
          let html = `<table class="m-vectors-results-table"><thead><tr><td colspan="3">${getValue('area')}</td></tr></thead><tbody>`;
          html += `<tr><td>m${'2'.sup()}</td><td>${m2}</td></tr>`;
          html += `<tr><td>ha</td><td>${ha}</td></tr>`;
          html += `<tr><td>km${'2'.sup()}</td><td>${km2}</td></tr>`;
          html += '</tbody></table>';
          infoContainer.innerHTML = html;
          if (this.feature.getStyle() !== undefined && this.feature.getStyle() !== null) {
            const style = this.feature.getStyle().getOptions();
            this.currentColor = style.fill.color;
            document.querySelector('#colorSelector').value = style.fill.color;
            this.currentThickness = style.stroke.width || 6;
            document.querySelector('#thicknessSelector').value = style.stroke.width || 6;
          }
        }
        break;
      default:
        if (document.querySelector('#drawingtools #featureInfo') !== null) {
          document.querySelector('#drawingtools div.stroke-container').style.display = 'none';
          document.querySelector('#drawingtools #featureInfo').style.display = 'none';
        }
        break;
    }
  }

  /**
   * Deactivates selection mode.
   * @public
   * @function
   * @api
   */
  deactivateSelection() {
    const selector = '.m-vectors #m-vector-list div.m-vector-layer-actions-container';
    const selector2 = '#m-vector-list div.m-vector-layer-actions span';
    document.querySelectorAll(selector).forEach((elem) => {
      /* eslint-disable no-param-reassign */
      elem.innerHTML = '';
    });

    document.querySelectorAll(selector2).forEach((elem) => {
      /* eslint-disable no-param-reassign */
      elem.classList.remove('active-tool');
    });

    this.feature = undefined;
    this.geometry = undefined;
    this.emphasizeSelectedFeature();
    this.getImpl().removeEditInteraction();
    this.getImpl().removeSelectInteraction();
  }

  getProfile() {
    if (document.querySelector('.ol-profil.ol-unselectable.ol-control') !== null) {
      document.querySelector('.ol-profil.ol-unselectable.ol-control').remove();
    }

    this.getImpl().calculateProfile(this.feature);
    // this.deactivateDrawing();
    // this.deactivateSelection();
  }
}
