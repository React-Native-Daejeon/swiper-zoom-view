<h1 align="center">
    Swiper Zoom View
</h1>
<p align='center'>
	<a href="https://badge.fury.io/js/swiper-zoom-view">
		<img src="https://badge.fury.io/js/swiper-zoom-view.svg" alt="npm version">
	</a>
	<a href="[https://github.com/React-Native-Daejeon/swiper-zoom-view/blob/master/LICENSE](https://github.com/React-Native-Daejeon/swiper-zoom-view/blob/master/LICENSE)">
	<img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="Swiper Zoom View is released under the MIT license"/>
	</a>
</p>

Swiper Zoom View는 간단한 이미지 갤러리 뷰를 보여주는 UI Component이며, iOS 및 Android 모두에서 사용이 가능합니다. Swiper Zoom View를 사용하면, 이미지들을 넘겨서 확인할 수 있으며 몇 가지 간단한 줌 액션을 사용할 수 있습니다. 

Swiper Zoom View is a simple React Native UI Component that shows images gallery view for iOS and Android. You can use some zoom actions of image.

<br />

## 🙆‍♀ Installation
아래의 명령어를 통해 swiper-zoom-view를 설치할 수 있습니다.
Through the command to install swiper-zoom-view.

```bash
npm install --save swiper-zoom-view
```

<br />

## 📌 How to use
swiper-zoom-view를 import하고 render에서 아래와 같이 사용할 수 있습니다.
Import swiper-zoom-view and you can use it as below.

```js
import SwiperView from 'swiper-zoom-view';

...

return (
 <SwiperView
  initialData={[require("./image1.png"), require("./image2.png")]}
  initialScrollIndex={0}
 />
);
```

<br />

## 📒 Props

아래의 모든 props를 사용하여 Swiper Zoom View를 적절하게 커스터마이징 하여 사용할 수 있습니다.
You can use all of the props below and customize Swiper Zoom View.

| props | required | type | description |
|-------|----------|--------|--------------------|
| initialData | O | image[ ] | List of images that is showed. Type of images is `string` or `object` that contains uri field|
| initialScrollIndex | X (default is `0`) | number | Index of image that is showed first .|
| width | X (default is `full width size` of window) | number | Width of swiper view component |
| height | X (default is `full height size` of window) | number | Height of swiper view component|
| backgroundColor | X (default is `black`) | string | Color of background |
| renderItem | X (default is `(info: ListRenderItemInfo) => React.Element`) | ListRenderItem | How to render the images |
| onRefresh | X  | (prevData: images[], prevIndex: number) => PromiseLike<{newIndex: number, newData: image[]}> | How to refresh the view |

<br />

## 📱 Example (Demo)
![](example/demo.gif)

<br />

## 📑 License
Swiper Zoom View is released under the [MIT license](https://github.com/React-Native-Daejeon/swiper-zoom-view/blob/master/LICENSE).
