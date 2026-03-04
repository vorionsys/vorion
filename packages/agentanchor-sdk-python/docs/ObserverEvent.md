# ObserverEvent


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **UUID** |  | [optional] 
**event_type** | **str** |  | [optional] 
**agent_id** | **UUID** |  | [optional] 
**severity** | **str** |  | [optional] 
**data** | **object** |  | [optional] 
**hash** | **str** |  | [optional] 
**timestamp** | **datetime** |  | [optional] 

## Example

```python
from agentanchor.models.observer_event import ObserverEvent

# TODO update the JSON string below
json = "{}"
# create an instance of ObserverEvent from a JSON string
observer_event_instance = ObserverEvent.from_json(json)
# print the JSON string representation of the object
print(ObserverEvent.to_json())

# convert the object into a dict
observer_event_dict = observer_event_instance.to_dict()
# create an instance of ObserverEvent from a dict
observer_event_from_dict = ObserverEvent.from_dict(observer_event_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


