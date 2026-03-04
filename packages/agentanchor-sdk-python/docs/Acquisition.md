# Acquisition


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **UUID** |  | [optional] 
**listing_id** | **UUID** |  | [optional] 
**consumer_id** | **UUID** |  | [optional] 
**status** | **str** |  | [optional] 
**acquired_at** | **datetime** |  | [optional] 

## Example

```python
from agentanchor.models.acquisition import Acquisition

# TODO update the JSON string below
json = "{}"
# create an instance of Acquisition from a JSON string
acquisition_instance = Acquisition.from_json(json)
# print the JSON string representation of the object
print(Acquisition.to_json())

# convert the object into a dict
acquisition_dict = acquisition_instance.to_dict()
# create an instance of Acquisition from a dict
acquisition_from_dict = Acquisition.from_dict(acquisition_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


