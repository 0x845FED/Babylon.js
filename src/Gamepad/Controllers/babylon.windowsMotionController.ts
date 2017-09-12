module BABYLON {
    export class WindowsMotionController extends GenericController {

        // TODO: Update with final asset URL's
        private static readonly MODEL_BASE_URL:string = 'http://yoda.blob.core.windows.net/models/';
        private static readonly MODEL_LEFT_FILENAME:string = 'genericvrcontroller.babylon';
        private static readonly MODEL_RIGHT_FILENAME:string = 'genericvrcontroller.babylon';
        private static readonly MODEL_UNIVERSAL_FILENAME:string = 'genericvrcontroller.babylon';
        private static readonly MODEL_ROOT_NODE_NAME:string = 'RootNode';
        private static readonly GLTF_ROOT_TRANSFORM_NAME:string = 'root';

        public static readonly GAMEPAD_ID_PREFIX:string = 'Spatial Controller (Spatial Interaction Source) ';
        private static readonly GAMEPAD_ID_PATTERN = /([0-9a-zA-Z]+-[0-9a-zA-Z]+)$/;

        // TODO: Why do we need to flip the model around? Art asset or BabylonJS specific?
        private static readonly ROTATE_OFFSET:number[] = [Math.PI, 0, 0]; // x, y, z.

        private _loadedMeshInfo: LoadedMeshInfo;
        private readonly _mapping : IControllerMappingInfo = {
            // Semantic button names
            buttons: ['thumbstick', 'trigger', 'grip', 'menu', 'trackpad'],
            // A mapping of the button name to glTF model node name
            // that should be transformed by button value.
            buttonMeshNames: {
                'trigger': 'SELECT',
                'menu': 'MENU',
                'grip': 'GRASP',
                'thumbstick': 'THUMBSTICK_PRESS',
                'trackpad': 'TOUCHPAD_PRESS'
            },
            // This mapping is used to translate from the Motion Controller to Babylon semantics
            buttonObservableNames: {
                'trigger': 'onTriggerStateChangedObservable',
                'menu': 'onSecondaryButtonStateChangedObservable',
                'grip': 'onMainButtonStateChangedObservable',
                'thumbstick': 'onPadStateChangedObservable',
                'trackpad': 'onTrackpadChangedObservable'
            },
            // A mapping of the axis name to glTF model node name
            // that should be transformed by axis value.
            // This array mirrors the browserGamepad.axes array, such that 
            // the mesh corresponding to axis 0 is in this array index 0.
            axisMeshNames: [
                'THUMBSTICK_X',
                'THUMBSTICK_Y',
                'TOUCHPAD_TOUCH_X',
                'TOUCHPAD_TOUCH_Y'
            ]
        };

        public onTrackpadChangedObservable = new Observable<ExtendedGamepadButton>();

        constructor(vrGamepad) {
            super(vrGamepad);
            this.controllerType = PoseEnabledControllerType.WINDOWS;
            this._loadedMeshInfo = null;
        }
        
        public get onTriggerButtonStateChangedObservable() {
            return this.onTriggerStateChangedObservable;
        }

        public get onMenuButtonStateChangedObservable() {
            return this.onSecondaryButtonStateChangedObservable;
        }

        public get onGripButtonStateChangedObservable() {
            return this.onMainButtonStateChangedObservable;
        }

        public get onThumbstickButtonStateChangedObservable() {
            return this.onPadStateChangedObservable;
        }    

        public get onTouchpadButtonStateChangedObservable() {
            return this.onTrackpadChangedObservable;
        }
        
        /**
         * Called once per frame by the engine.
         */
        public update() {
            super.update();
            
            // Only need to animate axes if there is a loaded mesh
            if (this._loadedMeshInfo) {
                if (this.browserGamepad.axes) {
                    for (let axis = 0; axis < this._mapping.axisMeshNames.length; axis++) {
                        this.lerpAxisTransform(axis, this.browserGamepad.axes[axis]);
                    }
                }
            }
        }
        
        /**
         * Called once for each button that changed state since the last frame
         * @param buttonIdx Which button index changed
         * @param state New state of the button
         * @param changes Which properties on the state changed since last frame
         */
        protected handleButtonChange(buttonIdx: number, state: ExtendedGamepadButton, changes: GamepadButtonChanges) {
            let buttonName = this._mapping.buttons[buttonIdx];
            if (!buttonName) return; 

            // Only emit events for buttons that we know how to map from index to name
            let observable = this[this._mapping.buttonObservableNames[buttonName]];
            if (observable) {
                observable.notifyObservers(state);
            }

            this.lerpButtonTransform(buttonName, state.value);
        }
        
        protected lerpButtonTransform(buttonName: string, buttonValue: number) {
            
            // If there is no loaded mesh, there is nothing to transform.
            if (!this._loadedMeshInfo) return;

            var meshInfo = this._loadedMeshInfo.buttonMeshes[buttonName];
            BABYLON.Quaternion.SlerpToRef(
                meshInfo.unpressed.rotationQuaternion, 
                meshInfo.pressed.rotationQuaternion, 
                buttonValue,
                meshInfo.value.rotationQuaternion);
            BABYLON.Vector3.LerpToRef(
                meshInfo.unpressed.position, 
                meshInfo.pressed.position,
                buttonValue,
                meshInfo.value.position);
        }
        
        protected lerpAxisTransform(axis:number, axisValue: number) {
            let meshInfo = this._loadedMeshInfo.axisMeshes[axis];
            if (!meshInfo) return;

            // Convert from gamepad value range (-1 to +1) to lerp range (0 to 1)
            let lerpValue = axisValue * 0.5 + 0.5;
            BABYLON.Quaternion.SlerpToRef(
                meshInfo.min.rotationQuaternion, 
                meshInfo.max.rotationQuaternion, 
                lerpValue,
                meshInfo.value.rotationQuaternion);
            BABYLON.Vector3.LerpToRef(
                meshInfo.min.position, 
                meshInfo.max.position,
                lerpValue,
                meshInfo.value.position);
        }
        
        /**
         * Implements abstract method on WebVRController class, loading controller meshes and calling this.attachToMesh if successful.
         * @param scene scene in which to add meshes
         * @param meshLoaded optional callback function that will be called if the mesh loads successfully.
         */
        public initControllerMesh(scene: Scene, meshLoaded?: (mesh: AbstractMesh) => void) {
            // Determine the device specific folder based on the ID suffix
            var device = 'default';
            if (this.id) {
                var match = this.id.match(WindowsMotionController.GAMEPAD_ID_PATTERN);
                device = ((match && match[0]) || device);
            }

            // Hand
            var filename;
            if (this.hand === 'left') {
                filename = WindowsMotionController.MODEL_LEFT_FILENAME;
            }
            else if (this.hand === 'right') {
                filename = WindowsMotionController.MODEL_RIGHT_FILENAME;
            }
            else {
                filename = WindowsMotionController.MODEL_UNIVERSAL_FILENAME;
            }

            let path = WindowsMotionController.MODEL_BASE_URL + device + '/';

            SceneLoader.ImportMesh("", path, filename, scene, (meshes: AbstractMesh[]) => {
                    // glTF files successfully loaded from the remote server, now process them to ensure they are in the right format.
                    this._loadedMeshInfo = this.processModel(scene, meshes);

                    this.attachToMesh(this._loadedMeshInfo.rootNode);
                    if (meshLoaded) {
                        meshLoaded(this._loadedMeshInfo.rootNode);
                    }
                }, 
                null, 
                (scene: Scene, message: string) => {
                    Tools.Log(message);
                    Tools.Warn('Failed to retrieve controller model from the remote server: ' + path + filename);
            });
        }

        /**
         * Takes a list of meshes (as loaded from the glTF file) and finds the root node, as well as nodes that 
         * can be transformed by button presses and axes values, based on this._mapping.
         * 
         * @param scene scene in which the meshes exist
         * @param meshes list of meshes that make up the controller model to process
         * @return structured view of the given meshes, with mapping of buttons and axes to meshes that can be transformed.
         */
        private processModel(scene: Scene, meshes: AbstractMesh[]) : LoadedMeshInfo {

            let loadedMeshInfo = null;

            // Create a new mesh to contain the glTF hierarchy
            let parentMesh = new BABYLON.Mesh(this.id + " " + this.hand, scene);

            // Find the root node in the loaded glTF scene, and attach it as a child of 'parentMesh'
            let childMesh : AbstractMesh = null;
            for (let i = 0; i < meshes.length; i++) {
                let mesh = meshes[i];
                if (mesh.id === WindowsMotionController.MODEL_ROOT_NODE_NAME) {
                    // There may be a parent mesh to perform the RH to LH matrix transform.
                    // Exclude controller meshes from picking results
                    mesh.isPickable = false;

                    // Handle root node, attach to the new parentMesh
                    if (mesh.parent && mesh.parent.name === WindowsMotionController.GLTF_ROOT_TRANSFORM_NAME)
                        mesh = <AbstractMesh>mesh.parent;
                    
                    childMesh = mesh;
                    break;
                }
            }

            if (childMesh) {
                childMesh.setParent(parentMesh);

                // Create our mesh info. Note that this method will always return non-null.
                loadedMeshInfo = this.createMeshInfo(parentMesh);

                // Apply rotation offsets
                var rotOffset = WindowsMotionController.ROTATE_OFFSET;
                childMesh.addRotation(rotOffset[0], rotOffset[1], rotOffset[2]);
            } else {
                Tools.Warn('No node with name ' + WindowsMotionController.MODEL_ROOT_NODE_NAME +' in model file.');
            }

            return loadedMeshInfo;
        }
        
        private createMeshInfo(rootNode: AbstractMesh) : LoadedMeshInfo {

            let loadedMeshInfo = new LoadedMeshInfo();
            var i;
            loadedMeshInfo.rootNode = rootNode;

            // Reset the caches
            loadedMeshInfo.buttonMeshes = {};
            loadedMeshInfo.axisMeshes = {};

            // Button Meshes
            for (i = 0; i < this._mapping.buttons.length; i++) {
                var buttonMeshName = this._mapping.buttonMeshNames[this._mapping.buttons[i]];
                if (!buttonMeshName) {
                    Tools.Log('Skipping unknown button at index: ' + i + ' with mapped name: ' + this._mapping.buttons[i]);
                    continue;
                }

                var buttonMesh = getChildByName(rootNode, buttonMeshName);
                if (!buttonMesh) {
                    Tools.Warn('Missing button mesh with name: ' + buttonMeshName);
                    continue;
                }

                var buttonMeshInfo = {
                    index: i,
                    value: getImmediateChildByName(buttonMesh, 'VALUE'),
                    pressed: getImmediateChildByName(buttonMesh, 'PRESSED'),
                    unpressed: getImmediateChildByName(buttonMesh, 'UNPRESSED')
                };
                if (buttonMeshInfo.value && buttonMeshInfo.pressed && buttonMeshInfo.unpressed) {
                    loadedMeshInfo.buttonMeshes[this._mapping.buttons[i]] = buttonMeshInfo;
                } else {
                    // If we didn't find the mesh, it simply means this button won't have transforms applied as mapped button value changes.
                    Tools.Warn('Missing button submesh under mesh with name: ' + buttonMeshName +
                        '(VALUE: ' + !!buttonMeshInfo.value +
                        ', PRESSED: ' + !!buttonMeshInfo.pressed +
                        ', UNPRESSED:' + !!buttonMeshInfo.unpressed +
                        ')');
                }
            }

            // Axis Meshes
            for (i = 0; i < this._mapping.axisMeshNames.length; i++) {
                var axisMeshName = this._mapping.axisMeshNames[i];
                if (!axisMeshName) {
                    Tools.Log('Skipping unknown axis at index: ' + i);
                    continue;
                }

                var axisMesh = getChildByName(rootNode, axisMeshName);
                if (!axisMesh) {
                    Tools.Warn('Missing axis mesh with name: ' + axisMeshName);
                    continue;
                }

                var axisMeshInfo = {
                    index: i,
                    value: getImmediateChildByName(axisMesh, 'VALUE'),
                    min: getImmediateChildByName(axisMesh, 'MIN'),
                    max: getImmediateChildByName(axisMesh, 'MAX')
                };
                if (axisMeshInfo.value && axisMeshInfo.min && axisMeshInfo.max) {
                    loadedMeshInfo.axisMeshes[i] = axisMeshInfo;
                } else {
                    // If we didn't find the mesh, it simply means thit axis won't have transforms applied as mapped axis values change.
                    Tools.Warn('Missing axis submesh under mesh with name: ' + axisMeshName +
                        '(VALUE: ' + !!axisMeshInfo.value +
                        ', MIN: ' + !!axisMeshInfo.min +
                        ', MAX:' + !!axisMeshInfo.max +
                        ')');
                }
            }

            return loadedMeshInfo;
            
            // Look through all children recursively. This will return null if no mesh exists with the given name.
            function getChildByName(node, name) {
                return node.getChildMeshes(false, n => n.name === name)[0];
            }
            // Look through only immediate children. This will return null if no mesh exists with the given name.
            function getImmediateChildByName (node, name) : AbstractMesh {
                return node.getChildMeshes(true, n => n.name == name)[0];
            }
        }
    }

    class LoadedMeshInfo {
        public rootNode: AbstractMesh;
        public pointingPoseNode: AbstractMesh;
        public holdingPoseNode: AbstractMesh;
        public buttonMeshes: { [id: string] : IButtonMeshInfo; } = {};
        public axisMeshes: { [id: number] : IAxisMeshInfo; } = {};
    }

    interface IMeshInfo {
        index: number;
        value: AbstractMesh;
    }

    interface IButtonMeshInfo extends IMeshInfo {
        pressed: AbstractMesh;
        unpressed: AbstractMesh;
    }

    interface IAxisMeshInfo extends IMeshInfo {
        min: AbstractMesh;
        max: AbstractMesh;
    }

    interface IControllerMappingInfo {
        buttons: string[];
        buttonMeshNames: { [id: string ] : string };
        buttonObservableNames: { [id: string ] : string };
        axisMeshNames: string[];
    }

    interface IControllerUrl {
        path: string;
        name: string;
    }
}
