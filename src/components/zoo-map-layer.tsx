import { CircleLayer, Images, ShapeSource, SymbolLayer } from '@rnmapbox/maps';
import { useMemo, useRef } from 'react';
import { zooMapShape, type ZooMapSite } from '@/lib/zoo-map';

const ZOO_IMAGES = { 'safaroll-zoo': require('../../assets/map/zoo-marker.png') };

export function ZooMapLayer({ sites, onSelect, onZoom, belowLayerID }: {
  sites: ZooMapSite[]; onSelect: (site: ZooMapSite) => void;
  belowLayerID: string;
  onZoom: (coordinates: number[], zoom: number) => void;
}) {
  const ref = useRef<ShapeSource>(null);
  const shape = useMemo(() => zooMapShape(sites), [sites]);
  return <><Images images={ZOO_IMAGES} /><ShapeSource id="safari-zoos" ref={ref} shape={shape} cluster clusterRadius={45} clusterMaxZoomLevel={12}
    onPress={async event => {
      const feature = event.features[0];
      if (!feature || feature.geometry.type !== 'Point') return;
      if (feature.properties?.cluster) {
        const zoom = await ref.current?.getClusterExpansionZoom(feature).catch(() => 13);
        onZoom(feature.geometry.coordinates, zoom ?? 13);
      } else {
        const site = sites.find(item => item.id === feature.properties?.id);
        if (site) onSelect(site);
      }
    }}>
    <CircleLayer id="zoo-discs" belowLayerID={belowLayerID} filter={['has', 'point_count']} style={{ circleRadius: 19, circleColor: '#e3a93c', circleStrokeWidth: 2, circleStrokeColor: '#fff8e5', circleEmissiveStrength: 1 }} />
    <SymbolLayer id="zoo-labels" belowLayerID={belowLayerID} filter={['has', 'point_count']} style={{ textField: ['to-string', ['get', 'point_count']],
      textSize: 11, textColor: '#2b2418', textAllowOverlap: true, textIgnorePlacement: true, textEmissiveStrength: 1 }} />
    <SymbolLayer id="zoo-icons" belowLayerID={belowLayerID} filter={['!', ['has', 'point_count']]}
      style={{ iconImage: 'safaroll-zoo', iconSize: 52 / 192, iconAnchor: 'bottom',
        iconAllowOverlap: false, iconIgnorePlacement: false, iconPitchAlignment: 'viewport',
        iconRotationAlignment: 'viewport', iconEmissiveStrength: 1 }} />
    <SymbolLayer id="zoo-names" belowLayerID={belowLayerID} minZoomLevel={13} filter={['!', ['has', 'point_count']]}
      style={{ textField: ['get', 'name'], textSize: 12, textOffset: [0, 0.8], textAnchor: 'top', textColor: '#2b2418', textHaloColor: '#fff8e5', textHaloWidth: 2 }} />
  </ShapeSource></>;
}
