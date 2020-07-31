import * as React from 'react';
import {
  View,
  Text,
  FlatList,
  Animated,
  FlatListProps,
  ListRenderItem,
  ListRenderItemInfo,
  GestureResponderHandlers,
  GestureResponderEvent,
  Dimensions,
  Image
} from 'react-native';
import { createRef, RefObject } from 'react';

const FULL_WIDTH = Dimensions.get("window").width;
const FULL_HEIGHT = Dimensions.get("window").height;

type LocalResource = number
type PhotoObject = {
 uri: string;
}
type HasId = {
    id: string;
}

interface Position {
  x: number
  y: number
}

interface PinchInfo {
  center: Position,
  distance: number
}

/**
 * width, height, backgroundColor는 직접 줄 수 있습니다
 * ItemT는 require를 통해 생성되는 LocalResource 혹은 uri를 들고 있는
 * 이미지에 한해서만 가능합니다.
 * initalData는 view할 이미지 데이터를 말합니다
 * renderItem은 기본적으로 Image 컴포넌트로 구성되어있지만, 사용자 임의대로 
 * 구성할 수 있습니다.
 */
export type SwiperViewProps<ItemT> = {
  width: number
  height: number
  initialData: ItemT[]
  renderItem: ListRenderItem<ItemT>
  initialScrollIndex: number
  backgroundColor: string
  onRefresh: ( status: RefreshStatus, prevData: ItemT[], prevIndex: number ) => PromiseLike<{
    newIndex: number,
    newData: ItemT[]
  }>
}


export enum RefreshStatus {
  START = "RefreshState::START",
  END = "RefreshState::END",
  ALL = "RefreshState::ALL"
}

/**
 * 내부적으로 가지고 있는 FlatList와 공유하는 state 입니다.
 * 이들 값이 바뀌면 Flatlist도 refresh 됩니다.
 * 이외의 모든 값은 클래스 내부 변수로 넣어서 불필요한 refresh를 막습니다.
 */
type SwiperViewState<ItemT> = {
  refreshing: RefreshStatus | null,
  data: ItemT[],
  currentIndex: number,
}

/**
 * Single: 손가락 1개로 움직임
 * Double: 손가락 2개로 움직임
 * Other: 다른 상태. 참고로 손가락 떼면 무조건 Other 입니다.
 */
enum ChildStatus {
  SINGLE = "Child::SINGLE",
  DOUBLE = "Child::DOUBLE",
  OTHER = "Child::OTHER"
}

/**
 * 두손가락 터치의 경우
 * 1) 처음 두손가락으로 변한 좌표
 * 2) 손을 떼지 않은 가장 최근 두손가락 좌표
 * 3) 가장 최근 좌표의 타임스탬프
 * 
 * 한손가락 터치의 경우도 마찬가지
 * 
 * 어떠한 경우에도 첫 터치의 타임스탬프 lastTouch를 업데합니다.
 * 이건 따닥 두번 터치하는거 잡을 때 씁니다.
 */
type ChildState = ( {
  status: ChildStatus.DOUBLE
  initial: PinchInfo,
  last: PinchInfo,
  timestamp: number
} | {
  status: ChildStatus.SINGLE
  initial: Position,
  last: Position,
  timestamp: number
} | {
  status: ChildStatus.OTHER
} ) & {
  lastTouch: number
}

const DOUBLE_TOUCH_THRES = 300 
const MAX_ZOOM = 5 
const DEFAULT_ZOOM = 2 
const MIN_ZOOM = 0.5 
const MAX_ZOOM_RESET = 1.3 
const MIN_ZOOM_RESET = 0.0
const SOFT_ANIMIATION_TIME = 300 

/**
 * 좌표에 상수를 곱합니다. 원본은 건드리지 않습니다.
 * @param input 
 * @param value 
 */
const positionMult = ( input: Position, value: number ): Position => {
  return {
    x: input.x * value,
    y: input.y * value
  }
}

export default class SwiperViewComponent<ItemT = LocalResource | PhotoObject> extends React.PureComponent<
  React.PropsWithChildren<SwiperViewProps<ItemT>>, SwiperViewState<ItemT>> {
  static defaultProps = {
    backgroundColor: "black",
      width: FULL_WIDTH,
      height: FULL_HEIGHT,
    initialScrollIndex: 0,
    renderItem: (info:ListRenderItemInfo<LocalResource | PhotoObject>) => {
        return <Image source={info.item} style={{width: "100%", height:"100%", resizeMode:"contain"}} />
    },
    onRefresh: ( _: RefreshStatus, prevData: unknown[], prevIndex: number ) => {
      return {
        newIndex: prevIndex,
        newData: prevData
      }
    }
  }

  private doingChildAnimation: boolean
  private viewPort: {
    width: number,
    height: number,
  }

  private flatList: RefObject<FlatList<ItemT>>
  private rootView: RefObject<View>
  private absolutePosition: Position
  private scrollHandlers: Required<Pick<FlatListProps<ItemT>,
    "onContentSizeChange" |
    "onMomentumScrollEnd">>

  /**
   * 최상위 뷰에 등록할 제츠쳐 핸들러입니다
   * 무조건 최상위 뷰에 넣어야 합니다
   */
  private gestureHandlers: GestureResponderHandlers
  private scaleTarget: number
  private scaleAnimated: Animated.Value
  private transformBase: Position
  private transformAnimated: Animated.ValueXY
  private childState: ChildState
  private childDoingZoom: boolean

  constructor ( props: SwiperViewProps<ItemT> ) {
    super( props );
    this.state = {
      refreshing: null,
      data: this.props.initialData,
      currentIndex: this.props.initialScrollIndex,
    };
    this.viewPort = {
      width: this.props.width,
      height: this.props.height
    }
    this.childDoingZoom = false
    this.scaleTarget = 1
    this.scaleAnimated = new Animated.Value( this.scaleTarget )
    this.transformBase = { x: 0, y: 0 }

    /**
     * 기본 확대는 정 중앙에서 일어납니다.
     * 만약 중심점이 V(벡터) 만큼 벗어나 있다면
     * 1) 확대 배율이 없으면 중심점이 어디 찍히든 상관 없습니다.
     * 2) 확대가 일어나면 현재 배율에서 V가 배율에 따라 변화하는 만큼
     * ( V * (newScale - curScale) ) 만큼 변화하고 그거의 반대만큼 빼줘야 합니다.
     * 현재 값 기준 1이 기준이고 scaleTarget 이 변화량인에 이후에 유사 식을 보게 됩니다.
     */
    this.transformAnimated = new Animated.ValueXY(
      positionMult( this.transformBase, 1 - this.scaleTarget ) )

    this.flatList = createRef()
    this.rootView = createRef()
    this.absolutePosition = { x: 0, y: 0 }

    this.scrollHandlers = {
      onContentSizeChange: ( width ) => {
        const newWindowLength = Math.round( width / this.viewPort.width )
        if ( newWindowLength === this.state.data.length ) {
          this.flatList.current?.scrollToIndex( { index: this.state.currentIndex, animated: false } )
          this.setState( { ...this.state, refreshing: null } )
        }
      },

      onMomentumScrollEnd: ( event ) => {
        const newIndex = Math.round( event.nativeEvent.contentOffset.x / this.viewPort.width )
        if ( this.state.currentIndex !== newIndex ) {
          if ( newIndex === this.lastIndex() ) {
            // 이동 완료했더니 끝에 도달했음
            this.setState( { ...this.state, currentIndex: newIndex, refreshing: RefreshStatus.END } )
          } else if ( newIndex === 0 ) {
            // 이동 완료했더니 처음에 도달했음
            this.setState( { ...this.state, currentIndex: newIndex, refreshing: RefreshStatus.START } )
          } else {
            // 이동 완료했으니 currentIndex 값 업데이트
            this.setState( { ...this.state, currentIndex: newIndex } )
          }
        }
      },
    }

    this.doingChildAnimation = false
    this.childState = {
      status: ChildStatus.OTHER,
      lastTouch: 0
    }
    this.gestureHandlers = {
      onStartShouldSetResponder: ( event ) => {
        const ret = this.childDoingZoom
        if ( ret === false && event.nativeEvent.touches.length === 1 ) {
          this.onStartTouchResponder( event )
        }
        this.doChildStateChange(
          {
            ...this.childState,
            status: ChildStatus.OTHER
          }
        )
        return ret
      },
      onMoveShouldSetResponder: ( event ) => {
        const ret = this.childDoingZoom || event.nativeEvent.touches.length > 1
        return ret
      },
      onResponderTerminationRequest: ( event ) => {
        const ret = this.childDoingZoom || event.nativeEvent.touches.length > 1
        return !ret
      },
      onStartShouldSetResponderCapture: ( event ) => {
        const ret = this.childDoingZoom || event.nativeEvent.touches.length > 1
        return ret
      },
      onMoveShouldSetResponderCapture: ( event ) => {
        const ret = this.childDoingZoom || event.nativeEvent.touches.length > 1
        return ret
      },
      onResponderMove: ( event ) => {
        this.onMoveTouchResponder( event )
      },
      onResponderRelease: ( _event ) => {
        this.doChildStateChange(
          {
            ...this.childState,
            status: ChildStatus.OTHER
          }
        )
        if ( this.scaleTarget > MIN_ZOOM_RESET && this.scaleTarget < MAX_ZOOM_RESET ) {
          this.doChildReset( SOFT_ANIMIATION_TIME )
        }
      },
      onResponderReject: ( _event ) => {
        this.doChildStateChange(
          {
            ...this.childState,
            status: ChildStatus.OTHER
          }
        )
      },
      onResponderTerminate: ( _event ) => {
        this.doChildStateChange(
          {
            ...this.childState,
            status: ChildStatus.OTHER
          }
        )
      },
      onResponderStart: ( event ) => {
        if ( event.nativeEvent.touches.length === 1 )
          this.onStartTouchResponder( event )
        else
          this.onMoveTouchResponder( event )
      },
    }
  }

  /**
   * 처음 터치를 담당합니다. 터치를 감지를 목적으로 합니다.
   * @param event 
   */
  onStartTouchResponder ( event: GestureResponderEvent ) {
    const timediff = event.timeStamp - this.childState.lastTouch
    /**
     * *** 주의사항 ***
     * 뷰 안에 다시 자식 뷰가 있을 경우
     * locationX는 최상위 뷰가 아닌 그 안에 있는 자식 뷰의 좌표값을 던집니다.
     * 최상위 뷰 입장에서는 터치를 인식해도 이를 해석할 방법이 없습니다.
     * 무조건 절대 좌표계 써야 합니다.
     */
    const newPos = {
      x: event.nativeEvent.pageX - this.absolutePosition.x,
      y: event.nativeEvent.pageY - this.absolutePosition.y
    }
    if ( timediff < DOUBLE_TOUCH_THRES ) {
      this.childState.lastTouch = 0
      if ( this.childState.status !== ChildStatus.SINGLE )
        this.doChildDoubleTouch( newPos, timediff )
    } else {
      this.childState.lastTouch = event.timeStamp
      this.doChildStateChange(
        {
          ...this.childState,
          initial: newPos,
          last: newPos,
          timestamp: event.timeStamp,
          status: ChildStatus.SINGLE
        }
      )
    }
  }

  /**
   * 이동 중인 터치 이벤트를 감지합니다.
   * 이론상 두손가락 터치는 "move" 에서만 감지되어야 하나
   * 지금처럼 동적으로 이벤트 처리를 막았다 풀었다 하는 과정에서
   * "start" 부터 두손가락 터치일 수 있습니다.
   * 여튼 이 로직에서 생으로 다 처리하니 적절히 호출만 해주면 됩니다.
   * @param event 
   */
  onMoveTouchResponder ( event: GestureResponderEvent ) {
    switch ( event.nativeEvent.touches.length ) {
      case 1: {
        // 1 finger
        // *** 반드시 절대 좌표계 사용 ***
        const newPos = {
          x: event.nativeEvent.pageX - this.absolutePosition.x,
          y: event.nativeEvent.pageY - this.absolutePosition.y
        }
        // 드래그 상황
        if ( this.childState.status === ChildStatus.SINGLE ) {
          this.doChildMove( this.childState.last, newPos,
            this.childState.timestamp - event.timeStamp )
          this.doChildStateChange(
            {
              ...this.childState,
              last: newPos,
              timestamp: event.timeStamp,
              status: ChildStatus.SINGLE
            }
          )
        } else {
          // 초기화로 넘겨줌
          this.doChildStateChange(
            {
              ...this.childState,
              initial: newPos,
              last: newPos,
              timestamp: event.timeStamp,
              status: ChildStatus.SINGLE
            }
          )
        }
        break
      }
      case 2: {
        // 2 finger
        // *** 반드시 절대 좌표계 사용 ***
        const touchA = {
          x: event.nativeEvent.touches[ 0 ].pageX - this.absolutePosition.x,
          y: event.nativeEvent.touches[ 0 ].pageY - this.absolutePosition.y
        }
        const touchB = {
          x: event.nativeEvent.touches[ 1 ].pageX - this.absolutePosition.x,
          y: event.nativeEvent.touches[ 1 ].pageY - this.absolutePosition.y
        }

        const newPinch: PinchInfo = {
          center: {
            x: ( touchA.x + touchB.x ) / 2,
            y: ( touchA.y + touchB.y ) / 2
          },
          distance: Math.sqrt(
            Math.pow( touchA.x - touchB.x, 2 ) +
            Math.pow( touchA.y - touchB.y, 2 )
          )
        }
        if ( this.childState.status === ChildStatus.DOUBLE ) {
          this.doChildPinchMove(
            this.childState.last, newPinch,
            this.childState.timestamp - event.timeStamp
          )
          this.doChildStateChange(
            {
              ...this.childState,
              timestamp: event.timeStamp,
              last: newPinch,
              status: ChildStatus.DOUBLE
            }
          )
        } else {
          this.doChildStateChange(
            {
              ...this.childState,
              initial: newPinch,
              timestamp: event.timeStamp,
              last: newPinch,
              status: ChildStatus.DOUBLE
            }
          )
        }
        break
      }
      default: {
        // unknown
        this.doChildStateChange(
          {
            ...this.childState,
            status: ChildStatus.OTHER
          }
        )
        break
      }
    }
  }

  doChildStateChange ( to: ChildState ) {
    if ( this.childState.status !== to.status ) {
      if ( to.status !== ChildStatus.SINGLE ) {
        this.childState.lastTouch = 0
      }

      if ( to.status === ChildStatus.DOUBLE ) {
        this.childDoingZoom = true
        this.flatList.current?.scrollToIndex( { index: this.state.currentIndex, animated: false } )
      }
    }
    this.childState = to
  }

  doChildReset ( timing: number ) {
    this.scaleTarget = 1
    this.transformBase.x = 0
    this.transformBase.y = 0
    this.doChildAnimation( timing, () => {
      this.childDoingZoom = false
    }, true )
  }

  doChildAnimation ( timing: number, callback: () => void = () => { }, override: boolean = false ) {
    if ( this.doingChildAnimation === true && !override )
      return
    if ( override ) {
      this.scaleAnimated.stopAnimation()
      this.transformAnimated.stopAnimation()
    }
    this.doingChildAnimation = true
    this.childDoingZoom = true

    const boundScaleTarget = Math.max( Math.min( this.scaleTarget, MAX_ZOOM ), MIN_ZOOM )
    this.scaleTarget = boundScaleTarget

    const boundDisposition = positionMult( this.transformBase, 1 )
    const maxX = ( this.viewPort.width * Math.abs( 1 - boundScaleTarget ) ) / 2
    const maxY = ( this.viewPort.height * Math.abs( 1 - boundScaleTarget ) ) / 2
    boundDisposition.x = Math.max( Math.min( boundDisposition.x, maxX ), -maxX )
    boundDisposition.y = Math.max( Math.min( boundDisposition.y, maxY ), -maxY )
    this.transformBase = boundDisposition

    Animated.parallel(
      [
        Animated.timing(
          this.scaleAnimated,
          {
            duration: timing,
            toValue: this.scaleTarget,
            useNativeDriver: true,
          }
        ),
        Animated.timing(
          this.transformAnimated,
          {
            duration: timing,
            toValue: this.transformBase,
            useNativeDriver: true,
          }
        )
      ],
      {
        stopTogether: true
      }
    ).start( () => {
      callback()
      this.doingChildAnimation = false
    } )
  }

  centerPosition (): Position {
    return {
      x: this.viewPort.width / 2,
      y: this.viewPort.height / 2
    }
  }
  getCenterDisposition ( pos: Position ): Position {
    const center = this.centerPosition()
    return {
      x: pos.x - center.x,
      y: pos.y - center.y
    }
  }

  doChildDoubleTouch ( secondTouch: Position, timediff: number ) {
    if ( !this.childDoingZoom ) {
      const scale = DEFAULT_ZOOM
      const center = this.getCenterDisposition( secondTouch )
      this.doChangeScale( { x: 0, y: 0 }, scale, center )
      this.doChildAnimation( SOFT_ANIMIATION_TIME, () => { }, true )
    } else {
      this.doChildReset( SOFT_ANIMIATION_TIME )
    }
  }

  doChildPinchMove ( prev: PinchInfo, next: PinchInfo, timeDiff: number ) {
    const newDisposition = {
      x: ( next.center.x - prev.center.x ),
      y: ( next.center.y - prev.center.y )
    }
    const updateScale = next.distance / prev.distance
    this.doChangeScale( newDisposition, updateScale, this.getCenterDisposition( prev.center ) )
    this.doChildAnimation( timeDiff )
  }
  /**
   * 
   * @param updateDisposition 현재 화면을 얼마나 이동시킬지 (보통 next - prev)
   * @param updateScale 현재 기준 확대/축소 비율
   * @param updateCenter 혹시 기준점이 변경되었다면 기입
   */
  doChangeScale ( updateDisposition: Position, updateScale: number, updateCenter?: Position ) {
    const newScale = this.scaleTarget * updateScale;

    const origDisposition = this.transformBase
    const centerToCenterDisposition = {
      x: 0,
      y: 0
    }
    if ( updateCenter !== undefined ) {
      centerToCenterDisposition.x = updateCenter.x - origDisposition.x
      centerToCenterDisposition.y = updateCenter.y - origDisposition.y
    }

    const newDisposition = positionMult( updateDisposition, 1 )

    let newCenterDisposition = positionMult( centerToCenterDisposition, ( 1 - updateScale ) )

    const disposition = {
      x: origDisposition.x + newDisposition.x + newCenterDisposition.x,
      y: origDisposition.y + newDisposition.y + newCenterDisposition.y,
    }

    this.transformBase = disposition
    this.scaleTarget = newScale;
  }

  doChildMove ( prev: Position, next: Position, timeDiff: number ) {
    if ( this.childDoingZoom && this.scaleTarget !== 1 ) {
      const newDisposition = {
        x: ( next.x - prev.x ),
        y: ( next.y - prev.y )
      }
      const updateScale = 1
      this.doChangeScale( newDisposition, updateScale )
      this.doChildAnimation( timeDiff )
    }
  }

  lastIndex () {
    let maxLength = this.state.data.length
    if ( maxLength > 0 ) {
      maxLength -= 1
    }
    return maxLength
  }

  async componentDidUpdate ( _prevProps: SwiperViewProps<ItemT>, prevState: SwiperViewState<ItemT> ) {
    if ( prevState.refreshing === null && this.state.refreshing !== null ) {
      const { newIndex, newData } = await this.props.onRefresh( this.state.refreshing, this.state.data, this.state.currentIndex )
      if ( newData.length === this.state.data.length ) {
        this.flatList.current?.scrollToIndex( { index: newIndex, animated: false } )
        this.setState( { ...this.state, refreshing: null, data: newData, currentIndex: newIndex } )
      } else {
        this.setState( { ...this.state, data: newData, currentIndex: newIndex } )
      }
    } else if ( prevState.refreshing !== null && this.state.refreshing === null ) {

    }
  }

  wrapRenderItem ( info: ListRenderItemInfo<ItemT> ) {
    const itemView = this.props.renderItem( info )
    return (
      <View style={ {
        height: this.viewPort.height,
        width: this.viewPort.width,
        overflow: "hidden",
        flex: 1,
      } }
      >
        <Animated.View
          style={ {
            height: this.viewPort.height,
            width: this.viewPort.width,
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: "hidden",
            transform: info.index === this.state.currentIndex ? [
              {
                translateX: this.transformAnimated.x,
              },
              {
                translateY: this.transformAnimated.y
              },
              {
                scale: this.scaleAnimated
              }
            ] : undefined,
          } }
        >
          { itemView }
        </Animated.View>
      </View >
    )
  }

  hasId(p: any): p is HasId {
    return p !== undefined && typeof p.id === "string";
  }

  render (): JSX.Element {
    return (
      <View style={ {
        height: this.viewPort.height,
        width: this.viewPort.width,
        backgroundColor: this.props.backgroundColor
      } }
        { ...( this.gestureHandlers ) }
        ref={ this.rootView }
        onLayout={ () => {
          this.rootView.current?.measure(
            ( _x, _y, _width, _height, pageX, pageY ) => {
              this.absolutePosition = {
                x: pageX,
                y: pageY
              }
            },
          );
        } }
      >
        <Text>{ this.state.currentIndex }</Text>
        <FlatList<ItemT>
          initialScrollIndex={ this.state.currentIndex }
          getItemLayout={ ( _, index ) => ( {
            length: this.viewPort.width,
            offset: this.viewPort.width * index,
            index
          } ) }
          pagingEnabled={ true }
          scrollEnabled={ this.state.refreshing === null }
          data={ this.state.data }
          snapToAlignment={ "center" }
          renderItem={ ( info: ListRenderItemInfo<ItemT> ) => this.wrapRenderItem( info ) }
          horizontal={ true }
          keyExtractor={ ( item: ItemT, index: number ) => {
              if(this.hasId(item)) return item.id;
              else return index.toString();
          } }
          ref={ this.flatList }
          refreshing={ this.state.refreshing !== null }
          { ...this.scrollHandlers }
          onRefresh={ () => {
            this.setState( { ...this.state, refreshing: RefreshStatus.ALL } )
          } }
          extraData={ this.state }
          showsHorizontalScrollIndicator={ false }
          showsVerticalScrollIndicator={ false }
        />
      </View>
    );
  }
}